# Contract — Agent Sessions, Runs & Portable Checkpoints v1

**Stato**: proposto per schema9. Non pubblicare capability finché implementazione e composizione non esistono. Eredita integralmente [contratti trasversali](../../../docs/missing-features-contracts.md) e i confini del trasporto001/002 e client003.

## Envelope, grant e letture

Namespace locale `execution.*`, capability `executionVersion:1`; namespace canonico ledger `EXECUTION`. `prepare {action,intent,expectedRevisions}` è comune; risponde grantId,canonicalIntentHash,summary,expiresAt. Le mutazioni consumano grant su intent conservato dal core con requestId UUID e revisioni; gli input indicati nella tabella sono il contenuto canonico da preparare e verificare, non campi facoltativi.

CLI `maestro execution ... --state-dir ABS --json`; mutazioni con `--request-id UUID` e `--grant UUID` quando indicato. Input testuale tramite file/stdin bounded o artifactId sigillato; mai comandi shell, token o path privati forniti dal renderer. Metodi interni marcati internal non sono pubblicati via IPC/CLI. Nessun metodo di lettura può compiere inferenza, login, migrazione o cleanup.

`list/get`, `operation.get {requestId}`, `artifact.get {artifactId,cursor?}` e `output.list` dove applicabile: pagine metadata≤20 ed envelope≤32KiB, chunk8KiB raw con hash/base64, cursori store/target/revision-bound. `get` restituisce entityId,state,stateRevision,configRevision quando applicabile,freshness,checkedAt,safeError; riferimento a artefatto privato non espone path. LIST offline LAST_KNOWN; controlli attuali richiedono daemon e operazione esplicita.

`list {projectId, activeOnly:true}` restituisce al massimo una sessione del progetto associata al run ancora aperto. La CLI usa `execution list PROJECT --active-only`. Sia questa lista sia `get` espongono `agent` con ID e fase del run, provider, titolo della feature e modello associato alla revisione registrata. Il modello resta recuperabile dal ledger dopo una riconfigurazione e può essere assente se manca l’evidenza storica. Il dettaglio Desktop legge gli artefatti di output dello stesso run.

## Metodi e risultati

Ogni metodo è sotto `execution.`; sottosezioni mantengono associazione esplicita alla storia. `requestId` è obbligatorio per ogni mutazione, incluso refresh/configure/reconcile. Dove non è indicato grant: lettura pura o osservazione locale/remote esplicitamente richiesta senza ulteriore effetto; start/install/merge/push/deploy restano sempre soggetti a grant/policy core. Progetti/entità bersaglio rimossi o store differente sono rifiutati.

### US1 — Avviare una sessione di implementazione autorizzata

| Metodo / CLI equivalente | Intent canonico / input | Risultato dopo admission o lettura |
|---|---|---|
| `provider.get` | providerId | config,capabilities,qualification |
| `provider.configure` | providerId,binaryHandle,modelId,authProfileRef,grantId | configRevision |
| `provider.check` | providerId,expectedConfigRevision,requestId | availability,capabilityDigest |
| `start` | featureId,workspaceId,profileResolutionId,envelopeId,grantId | sessionId,runId,operationId |

### US2 — Monitorare e interagire senza dipendere dalla UI

| Metodo / CLI equivalente | Intent canonico / input | Risultato dopo admission o lettura |
|---|---|---|
| `output.list` | runId,cursor? | chunks,watermark,truncated |
| `answer` | interactionId,expectedRevision,answerArtifactId,grantId | answerId |
| `pause` | sessionId,expectedStateRevision,grantId | PAUSING/PAUSED |
| `cancel` | sessionId,expectedStateRevision,grantId | CANCELLING/CANCELLED |

### US3 — Recuperare e riprendere da checkpoint

| Metodo / CLI equivalente | Intent canonico / input | Risultato dopo admission o lettura |
|---|---|---|
| `checkpoint` | sessionId,expectedStateRevision,grantId | checkpointId,digest |
| `resume` | sessionId,checkpointId,providerId,grantId | newRunId,newGeneration |
| `get` | sessionId | state,run,checkpoint,freshness |
| `reconcile` | sessionId,requestId | observations,outcome |

Regole specifiche di transizione, approvazione e recovery: [policy.md](policy.md).

## Validazione, completion ed errori

UUID validati, DTO chiusi, revisioni decimali positive, digest e enum allowlist; unknown field/command/flag rifiutato. Il risultato mutativo è `{accepted,requestId,entityId?,operationId?,stateRevision}` entro target2s. `operation.get` espone `{action,phase,outcome,acceptedAt,completedAt?,resultIds,safeError}`; stato operazione e lifecycle distinguibili. Stesso requestId/hash recupera il risultato originale; conflitto di intento/namespace → IDEMPOTENCY_CONFLICT. NOT_FOUND dopo un esito incerto non è autorizzazione a ripetere.

Lavoro lungo: admission asincrona, job con deadline e query; output paginato. Timeout non è prova di mancata esecuzione o uscita. Risposta persa → UNKNOWN_OUTCOME con UUID originale. Una nuova operazione può partire solo dopo riconciliazione o nuova autorizzazione pertinente.

Errori specifici: `EXECUTION_UNSUPPORTED, PROVIDER_UNSAFE, PROVIDER_AUTH_REQUIRED, PROVIDER_QUOTA, EXECUTION_APPROVAL_STALE, WORKSPACE_IN_USE, CHECKPOINT_STALE, PROCESS_UNKNOWN, TOOL_PERMISSION_REQUIRED`. Comuni: UNSUPPORTED, FEATURE_NOT_INITIALIZED, INVALID_REQUEST, APPROVAL_REQUIRED, APPROVAL_STALE, IDEMPOTENCY_CONFLICT, RESOURCE_LIMIT, ARTIFACT_CORRUPT. Errori pubblici statici/codici/nextAction, senza raw stderr o segreti. Non rendere un fallimento esterno come successo locale.

## Confini ed effetti

ExecutionProviderPort nuovo distinto dal ProviderPort004; ExecutionRuntimePort e host per-run in policy OS dedicata. Compartment provider/tool/command qualificati prima di accesso a codice reale; event/decoder neutri e niente SDK.

Agente scrive solo i file del workspace autorizzato; `.git`, refs/config/hooks e checkout originali non scrivibili. Commit/check di repository sono azioni core con manifest/versione.

Codex pin004 è un input da riqualificare per write/exec, non un via libera; Claude pin/supporto login da qualificare senza API key implicita. Capabilities per binario/hash/version/auth/policy, nativeResume solo se provato.

Stati e campi delle prove: [data-model.md](../data-model.md). Dettagli di cap e regole crash/ownership nei contratti trasversali; limiti specifici: 1run attivo per daemon prima010; un writer/workspace; run≤30min, input≤2MiB e≤512KiB profilo, output quote comuni;20interazioni/run,4KiB/testo; shutdown entro budget Foundation esistente.

## Desktop, eventi e prove

Main `apps/desktop/src/main/execution.ts` chiama CLI e salva ricevuta action/requestId/store/target prima dell’invio; shared DTO in `apps/desktop/src/shared/execution-contract.ts`, preload allowlist e renderer view senza accesso OS. Prepare/confirm mostra azione e ambito correnti; nessuna approvazione ricavata dal prompt. Disabilitare mutazioni offline; history disponibile con data. Epoch di archivio/target e revisioni scartano risultati tardivi.

Eventi `execution.changed`, `execution.output.available` dove applicabile: solo IDs/stato/codice/revisione/watermark; payload testo/diff/documento recuperato via pagina. Estendere core e desktop allowlist nello stesso incremento. Replay/ACK e limiti journal invariati. Test contract API/CLI/bridge e integrazione locale dimostrano validazione, idempotenza cross-namespace, stale grant, output/quote pieni e privacy.
