# Data Model — Project Registry

**Implementation status**: schema 3, ledger e commit REGISTER/VERIFY/UPDATE implementati; REMOVE resta da aggiungere.
Upgrade dalla nuova Foundation schema 2 qualificato con crash pre/post commit. Non è migrazione del
precedente Maestro. UUID e timestamp UTC ISO-8601; revisioni positive rese in JSON
come stringhe decimali, senza perdita di precisione. Date di ordinamento logico
non sono identità né sostituiscono clock monotono per le deadline.

## Project — tabella projects

| Campo | Vincolo/significato |
|---|---|
| project_id | UUID PK, creato soltanto al commit che vince la dedup |
| display_name | Trim esterno, 1–120 Unicode scalar values, nessun carattere Cc; rifiutare surrogati isolati; nomi duplicati ammessi |
| repository_key | Hash canonico della prova comune versionata; UNIQUE parziale su removed_at IS NULL |
| repository_identity | Canonical common-dir e anchor volume/device/inode/birthtime; formato versionato interno, non dato da loggare |
| reference_checkout | Root canonica, admin Git dir e rispettivi anchor; fissati alla prima registrazione confermata |
| base_branch | Nome breve locale nullable; niente fallback main/master/remoti |
| config_revision | Parte da 1; incrementata da update effettivo e remove, non da verify/import duplicato |
| created_at / updated_at | Date del registro, non Git |
| removed_at | Null = ACTIVE; data = REMOVED tombstone |

Un indice UNIQUE parziale sul repository_key coordina import concorrenti. Il confronto
considera anche la prova completa, non solo un hash. Stesso path con anchor differenti
non sostituisce il progetto esistente: registrazione bloccata per identità cambiata
finché l'utente non rimuove esplicitamente la vecchia registrazione. Stesso anchor a
un path differente è identità incerta, senza aggiornamento implicito del riferimento.

Nessun campo remoto, sorgente, diff, credenziale, readiness o Discovery approval.
La rimozione conserva tombstone e risultati operazione; una nuova registrazione
usa nuovo UUID e base/config derivate dal nuovo intento.

## RepositoryObservation — tabella project_observations

Una ultima osservazione per progetto, FK project_id. Nessuna cronologia illimitata
di snapshot; lo storico diagnostico limitato è negli eventi. Le osservazioni rimosse
restano associate alla tombstone, non appaiono nella lista attiva.

| Campo | Valori/significato |
|---|---|
| observation_revision | Contatore per progetto, incrementa solo alla pubblicazione atomica |
| observed_config_revision | Configurazione alla quale si riferisce la verifica |
| request_id / observed_instance_id | Origine/correlazione |
| started_at / completed_at | Intervallo, non snapshot atomico del filesystem |
| reference_checkout | Riferimento esatto osservato, immutabile rispetto a Project |
| checkout_availability | VERIFIED / UNAVAILABLE / UNKNOWN |
| repository_identity_status | VERIFIED / CHANGED / UNVERIFIED; CHANGED non salva una nuova identità |
| has_commits | Commit raggiungibile da HEAD o ref: true / false / null (non verificato); niente inventario di oggetti irraggiungibili |
| head_kind | BRANCH / DETACHED / UNBORN / UNKNOWN |
| current_branch / head_oid | Nullable; OID con object format dichiarato SHA-1 o SHA-256 |
| base_state / base_oid | UNCONFIGURED / VALID / INVALID / UNVERIFIED; OID nullable |
| tracked_changes / untracked_changes / conflicts | Boolean nullable; null non equivale a false |
| file_status_scope | REFERENCE_CHECKOUT_DIRECT_ENTRIES; esclude il contenuto interno dei submodule |
| limitations | Enum allowlisted, es. SUBMODULE_CONTENTS_NOT_INSPECTED, FILE_STATUS_UNVERIFIED |
| error | Codice/categoria/retryable/nextAction strutturati, nessuno stderr/path grezzo |

Base null implica UNCONFIGURED anche dopo il primo commit. Base configurata e non
più esistente implica INVALID solo con identità verificata e lettura refs riuscita;
errori/assenza checkout implicano UNVERIFIED, conservando il nome configurato.
UNAVAILABLE del reference checkout non prova che il common repository sia scomparso.
Ogni lettura presenta l'osservazione come datata; nessuna verifica implicita.

Quando un update cambia base o revisione, la precedente osservazione resta datata e
riferita alla vecchia revisione. La vista corrente espone base_state UNVERIFIED se
non esiste evidenza sulla nuova base; set-base può pubblicare una nuova osservazione
completa solo con contesto coerente. Una rinomina non inventa nuova evidenza Git.

## ProjectOperation — tabella project_operations

| Campo | Vincolo/significato |
|---|---|
| request_id | UUID PK/FK catalogo condiviso |
| action | REGISTER / VERIFY / UPDATE / REMOVE |
| payload_hash / canonical_intent | SHA-256 e intento normalizzato versionato, campi strutturati; non loggare payload |
| project_id | Nullable fino all'identificazione; risultato associa UUID se noto |
| expected_config_revision | Obbligatoria per UPDATE/REMOVE; verifica usa una captured revision interna |
| owning_instance_id / owner_uid | Da autenticazione e daemon, non fidarsi dei parametri client |
| phase | ACCEPTED / PROBING / FINALIZED |
| outcome | IN_PROGRESS / SUCCEEDED / FAILED / BLOCKED / INTERRUPTED |
| accepted_at / deadline_at / completed_at | Deadline runtime su clock monotono, data persistita diagnostica |
| result | Snapshot terminale immutabile: effect, projectId, revisioni, stato e safe error |

IN_PROGRESS è l'unico pending registry. BLOCKED è terminale, diversamente dal ledger
lifecycle esistente. TRANSITIONS: ACCEPTED → PROBING → FINALIZED per probe;
ACCEPTED → FINALIZED per update nome/remove; tutte le fasi non terminali possono
concludere FAILED/BLOCKED/INTERRUPTED. SUCCEEDED implica commit completo.

Un REGISTER duplicato valido termina SUCCEEDED/effect=EXISTING senza cambiare
progetto/osservazione. VERIFY che salva indisponibilità nota termina SUCCEEDED
con observation.error esplicito: è riuscita la registrazione dell'osservazione,
non la verifica positiva del repository. UPDATE fallito conserva tutta la config.

INTERRUPTED dopo crash non viene rieseguito. Retry identico restituisce quel risultato;
un nuovo comando volontario usa nuovo ID dopo lettura dello stato. Nessun risultato
idempotente eliminato con rotazione diagnostica.

## Catalogo requestId e metadati

`request_catalog`: request_id PK, scope LIFECYCLE/PROJECT, action, payload_hash.
Inserimento atomico con intento nella relativa tabella. Popolare le operazioni
lifecycle esistenti durante upgrade; nessun conflitto ignorato. Il writer lifecycle
deve usare il catalogo anche dopo l'upgrade. Stesso ID in altro scope è
IDEMPOTENCY_CONFLICT; non cambiare gli hash lifecycle già confermati.

`registry_metadata`: singleton, registry_revision. Incrementare per cambi visibili
alla lista (configurazione, osservazione, remove/import effettivo); non per soli
polling o intenti senza effetto. Consente pagine consistenti senza transazioni
aperte fra richieste. La revision store Foundation mantiene il suo significato.

## Concorrenza e invarianti

1. Autenticare prima di interrogare risultati riservati o ammettere lavoro.
2. Risolvere idempotenza prima di verificare revisione, path o repository corrente.
3. Primo commit valido vince la dedup; import concorrenti restituiscono lo stesso ID.
   Validare sempre input espliciti, inclusa base non valida, prima del commit duplicato.
4. UPDATE/REMOVE usano CAS su project_id attivo e expected_config_revision.
5. VERIFY cattura config revision e observation revision. Al commit confrontarle:
   se un altro verify o update è intervenuto, OBSERVATION_SUPERSEDED terminale,
   senza sovrascrivere l'evidenza più recente. Non serve una coda workflow per progetto.
6. Remove prevale su probe ancora in corso: quel probe non può ripubblicare il progetto.
7. Nome-only/remove non richiedono repo disponibile; set-base richiede nuova prova.
8. Progetto/risultato/eventi condividono un commit; mai evento di successo precommit.

## Conservazione e limiti

Nome ≤120 scalar values, path input/output ≤16 KiB UTF-8 e senza NUL; branch ≤1 KiB
UTF-8 e sintassi Git valida. Richieste rimangono entro frame 64 KiB. Revisioni/OID e
identità hanno limiti espliciti nei codec; dati fuori profilo producono errore.
Ledger e tombstone sono dati autorevoli: nessuna eliminazione automatica. Crescita
e spazio SQLite/WAL monitorati; saturazione restituisce PERSISTENCE_UNAVAILABLE,
non taglia risultati. La retention dei log/journal resta quella Foundation.
