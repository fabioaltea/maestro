# Contract — Feature Planning & Versioned Approval v1

**Stato**: proposto per schema5. Non pubblicare capability finché implementazione e composizione non esistono. Eredita integralmente [contratti trasversali](../../../docs/missing-features-contracts.md) e i confini del trasporto001/002 e client003.

## Envelope, grant e letture

Namespace locale `feature.*`, capability `featureVersion:1`; namespace canonico ledger `FEATURE`. `prepare {action,intent,expectedRevisions}` è comune; risponde grantId,canonicalIntentHash,summary,expiresAt. Le mutazioni consumano grant su intent conservato dal core con requestId UUID e revisioni; gli input indicati nella tabella sono il contenuto canonico da preparare e verificare, non campi facoltativi.

CLI `maestro feature ... --state-dir ABS --json`; mutazioni con `--request-id UUID` e `--grant UUID` quando indicato. Input testuale tramite file/stdin bounded o artifactId sigillato; mai comandi shell, token o path privati forniti dal renderer. Metodi interni marcati internal non sono pubblicati via IPC/CLI. Nessun metodo di lettura può compiere inferenza, login, migrazione o cleanup.

`list/get`, `operation.get {requestId}`, `artifact.get {artifactId,cursor?}` e `output.list` dove applicabile: pagine metadata≤20 ed envelope≤32KiB, chunk8KiB raw con hash/base64, cursori store/target/revision-bound. `get` restituisce entityId,state,stateRevision,configRevision quando applicabile,freshness,checkedAt,safeError; riferimento a artefatto privato non espone path. LIST offline LAST_KNOWN; controlli attuali richiedono daemon e operazione esplicita.

## Metodi e risultati

Ogni metodo è sotto `feature.`; sottosezioni mantengono associazione esplicita alla storia. `requestId` è obbligatorio per ogni mutazione, incluso refresh/configure/reconcile. Dove non è indicato grant: lettura pura o osservazione locale/remote esplicitamente richiesta senza ulteriore effetto; start/install/merge/push/deploy restano sempre soggetti a grant/policy core. Progetti/entità bersaglio rimossi o store differente sono rifiutati.

### US1 — Creare e correggere una feature

| Metodo / CLI equivalente | Intent canonico / input | Risultato dopo admission o lettura |
|---|---|---|
| `create` | projectId,expectedConfigRevision,requestArtifactId,grantId | featureId,stateRevision |
| `revise` | featureId,expectedStateRevision,bundleArtifactId,grantId | revisionId,bundleDigest |
| `archive` | featureId,expectedStateRevision,grantId | ARCHIVED o FEATURE_IN_USE |

### US2 — Approvare un piano e preparare l’implementazione

| Metodo / CLI equivalente | Intent canonico / input | Risultato dopo admission o lettura |
|---|---|---|
| `approve` | featureId,revisionId,bundleDigest,acceptedUnknownIds,grantId | approvalId |
| `handoff` | featureId,revisionId,expectedStateRevision,grantId | envelopeId,digest,eligible |
| `eligibility.get` | featureId | eligible,reason,checkedAt |

### US3 — Ottenere una bozza assistita e rispondere alle domande

| Metodo / CLI equivalente | Intent canonico / input | Risultato dopo admission o lettura |
|---|---|---|
| `generate` | featureId,expectedStateRevision,contextSnapshotId,grantId | planningTurnId,operationId |
| `answer` | featureId,turnId,questionId,answerArtifactId,grantId | newTurnId |
| `cancel` | featureId,expectedStateRevision,grantId | CANCELLING/INTERRUPTED |

Regole specifiche di transizione, approvazione e recovery: [policy.md](policy.md).

## Validazione, completion ed errori

UUID validati, DTO chiusi, revisioni decimali positive, digest e enum allowlist; unknown field/command/flag rifiutato. Il risultato mutativo è `{accepted,requestId,entityId?,operationId?,stateRevision}` entro target2s. `operation.get` espone `{action,phase,outcome,acceptedAt,completedAt?,resultIds,safeError}`; stato operazione e lifecycle distinguibili. Stesso requestId/hash recupera il risultato originale; conflitto di intento/namespace → IDEMPOTENCY_CONFLICT. NOT_FOUND dopo un esito incerto non è autorizzazione a ripetere.

Lavoro lungo: admission asincrona, job con deadline e query; output paginato. Timeout non è prova di mancata esecuzione o uscita. Risposta persa → UNKNOWN_OUTCOME con UUID originale. Una nuova operazione può partire solo dopo riconciliazione o nuova autorizzazione pertinente.

Errori specifici: `DISCOVERY_REQUIRED, APPROVAL_STALE, CONTEXT_CHANGED, REVISION_CONFLICT, PLANNING_UNAVAILABLE, FEATURE_IN_USE`. Comuni: UNSUPPORTED, FEATURE_NOT_INITIALIZED, INVALID_REQUEST, APPROVAL_REQUIRED, APPROVAL_STALE, IDEMPOTENCY_CONFLICT, RESOURCE_LIMIT, ARTIFACT_CORRUPT. Errori pubblici statici/codici/nextAction, senza raw stderr o segreti. Non rendere un fallimento esterno come successo locale.

## Confini ed effetti

Port FeaturePlanningPort separata da ProviderPort Discovery; stessa estrazione readonly e policy004 solo dopo una nuova qualifica dello schema di risultato. Authoring manuale è il primo slice.

Repository e Git in sola lettura; verificare il contesto Discovery corrente prima di creazione, approvazione e rilascio dell’handoff.

Manuale sempre senza inferenza; generazione disabilitata se provider non qualificato. Nessun nuovo SDK, API key o fallback per aggirare004.

Stati e campi delle prove: [data-model.md](../data-model.md). Dettagli di cap e regole crash/ownership nei contratti trasversali; limiti specifici: Richiesta≤16KiB; bundle≤256KiB;≤50criteri e20domande/turni; generation readonly≤10min, contesto≤30s; quota workflow condivisa.

## Desktop, eventi e prove

Main `apps/desktop/src/main/feature.ts` chiama CLI e salva ricevuta action/requestId/store/target prima dell’invio; shared DTO in `apps/desktop/src/shared/feature-contract.ts`, preload allowlist e renderer view senza accesso OS. Prepare/confirm mostra azione e ambito correnti; nessuna approvazione ricavata dal prompt. Disabilitare mutazioni offline; history disponibile con data. Epoch di archivio/target e revisioni scartano risultati tardivi.

Eventi `feature.changed`, `feature.output.available` dove applicabile: solo IDs/stato/codice/revisione/watermark; payload testo/diff/documento recuperato via pagina. Estendere core e desktop allowlist nello stesso incremento. Replay/ACK e limiti journal invariati. Test contract API/CLI/bridge e integrazione locale dimostrano validazione, idempotenza cross-namespace, stale grant, output/quote pieni e privacy.
