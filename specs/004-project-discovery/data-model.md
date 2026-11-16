# Data Model — Discovery

Schema4 dello stesso archivio. UUID e revisioni decimali stringa nei DTO; timestamp UTC, digest SHA256 esadecimale. Chiavi di dominio sempre storeId/projectId, mai nome progetto o solo path. Nessuna credenziale nel DB, nei manifest o nelle ricevute UI.

## Entità e persistenza

| Entità / tabella | Campi principali e regole |
|---|---|
| ProviderConfiguration / discovery_provider | providerId=codex, configRevision, nativeBinaryRealpath/hash/version, modelId, authProfileRef, policyVersion, qualificationDigest, configuredAt; no token. Cambi invalidano grant/capability precedente |
| ContextSnapshot / discovery_snapshots | snapshotId, projectId/configRevision, checkout/repository anchor, scope selectors/policyVersion, inventoryDigest, contextDigest, byte/file count, manifestArtifactId, state PREPARING/SEALED/INVALID, createdAt/expiresAt (scadenza soltanto finché non referenziato) |
| Discovery / discoveries | discoveryId, projectId, sessionId, state/stateRevision, snapshotId, providerConfigRevision, currentRunId, latestDocumentRevisionId, createdAt/updatedAt, safe error; registro storico immutabile nei legami |
| DiscoverySlot / discovery_slot | singleton1, discoveryId nullable, acquiredAt; CAS nella stessa transazione di admission, occupato anche WAITING_USER/RECONCILING |
| Run / discovery_runs | runId, discoveryId, generation UUID, turnIndex1..20, grantId, requestId, contextDigest/inputDigest, provider profile/model, phase, outcome, startedAt/endedAt, output watermarks, safe error, providerSessionRef opaco opzionale |
| Process / discovery_processes | runId/generation, owningInstanceId, hostPid/providerPid nullable, hostEndpoint, credentialRef, observation VERIFIED/ABSENT/UNKNOWN, releaseState OWNED/RELEASED/BLOCKED, policy cancel-on-owner-loss-v1; scope Agent Runtime, non Foundation |
| Grant / discovery_grants | grantId, ownerUid, action, target IDs/config/state revisions, snapshot/document/provider/model digests, canonicalIntentHash, expiresAt≤5min, consumedByRequestId; monouso per richiesta idempotente |
| Operation / discovery_operations | requestId, action, payloadHash, acceptedAt, phase, outcome, completedAt, bounded result IDs/error. Invarianti global UUID anche contro LIFECYCLE/PROJECT |
| Question / discovery_questions | questionId, discoveryId, originatingRunId, questionRevision, text≤4KiB, status OPEN/ANSWERED/UNKNOWN_ACCEPTED; massimo20 |
| Answer / discovery_answers | answerId, questionId/revision, requestId, answerRevision, value≤4KiB, kind ANSWER/UNKNOWN, userConfirmedAt; append-only, correzione esplicita |
| Revision / discovery_revisions | revisionId, discoveryId, revisionNumber, parentRevisionId, snapshotId/contextDigest, bundleArtifactId/digest/bytes, provenanceValidated, status DRAFT/READY_FOR_REVIEW/INVALID; immutabile |
| Approval / discovery_approvals | approvalId, requestId, revisionId/bundleDigest, projectId/configRevision, contextDigest, acceptedUnknownIds, ownerUid, approvedAt, checkedAt; decisione storica, mai booleano eterno |
| Output index / discovery_output | runId, seq stringa, artifactId/hash, bytes, kind PROGRESS/AGENT_TEXT, createdAt, truncated; chunk registrati prima di essere visibili, non raw stderr |
| Artifact metadata / discovery_artifacts | artifactId UUID, kind MANIFEST/CORPUS/DOCUMENT/OUTPUT/EXIT_PROOF, relativeKey generata dal core, sha256, allocatedBytes, committedAt, refCount/state; path mai da input client |

Corpi in `archive/discovery/objects/<artifactId>` e dir runtime per-run; oggetti regolari0600, root0700, niente symlink/hardlink. `discovery_budget` riserva byte/file prima delle scritture e conserva5MiB per finalizzazione/recovery. Cap64MiB/4096oggetti/100Discovery; niente cancellazione/eviction di output irrisolti o revisioni approvate. Quattro anteprime non avviate; TTL15min solo per preview non referenziate, snapshot usati da sessioni/documenti/approvazioni pinned senza scadenza. Discard esplicito e sicuro solo senza riferimenti. Nessun VACUUM o cleanup repository implicito.

## Commit e crash degli artefatti

1. Intento/reservation DB con UUID/key e quota; generazione bytes in file esclusivo con limite effettivo.
2. fsync file, publish atomica nella directory posseduta, fsync directory, verifica hash/owner.
3. Transazione writer: collega artefatto verificato e aggiorna stato/watermark/event metadata/outbox.
4. Crash fra2e3: file non autorevole, conservato e conteggiato; nessun riferimento visibile. Riferimento senza file/hash valido: ARTIFACT_CORRUPT, mai documento approvabile. Recovery non promuove output dal solo nome file.

Ogni mutazione DB bounded (no mega blob) rispetta checkpoint WAL/diagnostic budget attuale. Fonte/autorizzazione e output non entrano nel journal, soltanto IDs/stato/watermark.

## State machine

Discovery:

```text
PREPARING → READY_TO_START → RUNNING → WAITING_USER → RUNNING
                               ├→ READY_FOR_REVIEW → APPROVED
                               ├→ FAILED / INTERRUPTED / CANCELLED
                               └→ RECONCILING
READY_FOR_REVIEW / APPROVED → UPDATING → RUNNING (correzione intenzionale)
APPROVED → STALE (contesto/documento/configurazione non corrente)
```

READY_TO_START è l’anteprima non ancora accettata e non occupa lo slot. Admission di start/correzione acquisisce slot e grant atomicamente. WAITING_USER occupa lo slot pur senza processo. READY_FOR_REVIEW libera lo slot SOLO dopo prova di cessazione del run. APPROVED non occupa slot. Nuova correzione acquisisce nuovamente; BUSY non accoda. Cancellare WAITING_USER è una transizione locale immediata; cancellare un processo attivo richiede uscita verificata. UNKNOWN non è terminale.

Run.phase:

```text
SPAWN_INTENT → HOST_READY → SPAWN_AUTHORIZED → PROVIDER_RUNNING → EXIT_OBSERVED → FINALIZED
```

Host prima di SPAWN_AUTHORIZED non può avviare il provider. Grant/intent e identità host/generazione sono durevoli PRIMA del GO. Run.outcome RUNNING/SUCCEEDED/FAILED/CANCELLED/INTERRUPTED/TIMED_OUT/UNKNOWN è distinto da Operation.outcome (accettazione/transizione). Processo/provider da solo concluso non approva documentazione. Esito finale richiede uscita provata, frame finale valido, hash e contesto coerenti; altrimenti output parziale/INVALID/RECONCILING.

Core restart: verifica endpoint challenge/exit proof autenticata generazione e process absence. Mai segnale a un PID riletto. Host morto/provider incerto → RECONCILING, slot occupato. Cessazione dimostrata → INTERRUPTED, nessun nuovo run automatico. Domande precedenti WAITING_USER restano tali, continuazione esplicita con nuovo run.

## Context e approvazione

Manifest privato: scope normalizzato, policyVersion, membership di file selezionati, anchor repository/checkout, HEAD/headKind/branch, sourceId→relativePath/hash/size/lineCount, omissioni. Hash dei byte di working copy, non solo dei commit. Aggiunte/rimozioni dentro directory selezionate cambiano l’inventario; cambi fuori da una lista esplicita non sono descritti come coperti.

Prima di run, answer/correction, approval ed eligibility: ricattura fingerprint confinata, confronto con snapshot. Instabilità/permessi/timeout → UNKNOWN o STALE, niente CURRENT inventato. Approvazione CAS su stateRevision, configRevision, revisionId/bundleDigest e contextDigest, con domande risolte o UNKNOWN esplicitamente accettati. Il filesystem esterno non è atomicamente bloccato con SQLite: `checkedAt` dichiara l’istante; ogni successivo uso rivalida. Un nuovo documento non eredita approvazione, anche se una bozza precedente era stata approvata.

Eligibility DTO: `{projectId, eligible, reason, revisionId, approvalId, contextDigest, checkedAt, freshness}`. `eligible=true` solo da rivalidazione LIVE corrente; offline/timeout/identità cambiata/rimozione restituiscono eligible=false con APPROVAL_REQUIRED/STALE/UNKNOWN/PROJECT_REMOVED. Storico approvato consultabile anche offline, distinto dall’idoneità corrente.

## Aggiornamento schema

`request_catalog` storico e sue FK restano. `discovery_operations` ha PK requestId; trigger BEFORE INSERT in entrambe le direzioni e admission writer impediscono collisioni fra tutti i namespace; reservation query unifica LIFECYCLE/PROJECT/DISCOVERY. Consumo grant, acquisizione slot, ledger, run e outbox nella stessa transazione.

Versionare STORE_SCHEMA_V3 e upgrade2→3 prima di SCHEMA_VERSION4; aggiungere upgrade3→4 esclusivo, con store rebuild già usato, integrity/FK checks e fault prima/dopo commit. Writer4; reader2/3/4; registro≥3; Discovery4 oppure DISCOVERY_NOT_INITIALIZED. Nessuna migrazione del vecchio prodotto Maestro.

## Regole di admission per azione

Grant remoto/core richiesto per configure/start/answer/correct/approve/cancel;
preview e provider.check sono azioni locali intenzionali autenticate con UUID,
scope e budget, senza invio del corpus o inferenza. Discard locale richiede proprietà
e assenza riferimenti. Preparare grant non lancia provider. Grant preparati attivi
max32; nuovi grant/anteprime bloccati a capacità, query/cancel/reconcile sempre
consentiti usando la riserva terminale. Quota Discovery include artefatti allocati
e pagine dei metadati Discovery/indici, non soltanto i byte del testo.

### Precisazioni di admission T009

Il writer restituisce internamente `{operation,inserted}`: solo inserted=true
può attivare il nuovo lavoro; un replay restituisce la stessa operazione con
inserted=false. Il dettaglio interno non è il completamento del modello.
Le query operation esposte dal proxy/reader omettono canonicalIntent/payloadHash,
per preservare dati e limiti del frame. Il writer conserva l’intento privato.

Il cap32grant attivi riserva l’ultimo posto alla cancellazione. Una nuova
preparazione cancel intenzionale può revocare un precedente grant cancel non
consumato; non elimina sessioni, risultati o approvazioni. La riserva byte viene
applicata con il budget artefatti T012. Grant/session/run/slot/outbox condividono
la transazione del writer esistente.
