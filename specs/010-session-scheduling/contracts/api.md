# Contract — Session Scheduling, Quotas & Provider Policies v1

**Stato**: proposto per schema10. Non pubblicare capability finché implementazione e composizione non esistono. Eredita integralmente [contratti trasversali](../../../docs/missing-features-contracts.md) e i confini del trasporto001/002 e client003.

## Envelope, grant e letture

Namespace locale `scheduler.*`, capability `schedulerVersion:1`; namespace canonico ledger `SCHEDULER`. `prepare {action,intent,expectedRevisions}` è comune; risponde grantId,canonicalIntentHash,summary,expiresAt. Le mutazioni consumano grant su intent conservato dal core con requestId UUID e revisioni; gli input indicati nella tabella sono il contenuto canonico da preparare e verificare, non campi facoltativi.

CLI `maestro scheduler ... --state-dir ABS --json`; mutazioni con `--request-id UUID` e `--grant UUID` quando indicato. Input testuale tramite file/stdin bounded o artifactId sigillato; mai comandi shell, token o path privati forniti dal renderer. Metodi interni marcati internal non sono pubblicati via IPC/CLI. Nessun metodo di lettura può compiere inferenza, login, migrazione o cleanup.

`list/get`, `operation.get {requestId}`, `artifact.get {artifactId,cursor?}` e `output.list` dove applicabile: pagine metadata≤20 ed envelope≤32KiB, chunk8KiB raw con hash/base64, cursori store/target/revision-bound. `get` restituisce entityId,state,stateRevision,configRevision quando applicabile,freshness,checkedAt,safeError; riferimento a artefatto privato non espone path. LIST offline LAST_KNOWN; controlli attuali richiedono daemon e operazione esplicita.

## Metodi e risultati

Ogni metodo è sotto `scheduler.`; sottosezioni mantengono associazione esplicita alla storia. `requestId` è obbligatorio per ogni mutazione, incluso refresh/configure/reconcile. Dove non è indicato grant: lettura pura o osservazione locale/remote esplicitamente richiesta senza ulteriore effetto; start/install/merge/push/deploy restano sempre soggetti a grant/policy core. Progetti/entità bersaglio rimossi o store differente sono rifiutati.

### US1 — Accodare e limitare il lavoro tra progetti

| Metodo / CLI equivalente | Intent canonico / input | Risultato dopo admission o lettura |
|---|---|---|
| `enqueue` | jobIntentId,priority,notBefore?,grantId | jobId,position |
| `policy.configure` | limits,expectedRevision,grantId | policyRevision |
| `queue.list` | projectId?,cursor? | jobs,reasons,reservations |

### US2 — Attendere quote e riprendere con policy sticky

| Metodo / CLI equivalente | Intent canonico / input | Risultato dopo admission o lettura |
|---|---|---|
| `wait.get` | sessionId | reason,resetAt,source,nextAction |
| `schedule` | sessionId,notBefore,policyId,grantId | jobId |
| `pause` | jobId,expectedStateRevision,grantId | PAUSED |
| `cancel` | jobId,expectedStateRevision,grantId | CANCELLED/CANCELLING |

### US3 — Applicare fallback e scelta per costo con checkpoint

| Metodo / CLI equivalente | Intent canonico / input | Risultato dopo admission o lettura |
|---|---|---|
| `provider-policy.configure` | mode,providerRefs,capabilities,costRefs?,scope,grantId | policyId,revision |
| `switch.preview` | sessionId,checkpointId,targetProviderId | compatibility,summary |
| `switch` | sessionId,checkpointId,decisionDigest,grantId | newRunId |
| `policy.revoke` | policyId,expectedRevision,grantId | revokedRevision |

Regole specifiche di transizione, approvazione e recovery: [policy.md](policy.md).

## Validazione, completion ed errori

UUID validati, DTO chiusi, revisioni decimali positive, digest e enum allowlist; unknown field/command/flag rifiutato. Il risultato mutativo è `{accepted,requestId,entityId?,operationId?,stateRevision}` entro target2s. `operation.get` espone `{action,phase,outcome,acceptedAt,completedAt?,resultIds,safeError}`; stato operazione e lifecycle distinguibili. Stesso requestId/hash recupera il risultato originale; conflitto di intento/namespace → IDEMPOTENCY_CONFLICT. NOT_FOUND dopo un esito incerto non è autorizzazione a ripetere.

Lavoro lungo: admission asincrona, job con deadline e query; output paginato. Timeout non è prova di mancata esecuzione o uscita. Risposta persa → UNKNOWN_OUTCOME con UUID originale. Una nuova operazione può partire solo dopo riconciliazione o nuova autorizzazione pertinente.

Errori specifici: `QUEUE_FULL, RESOURCE_WAIT, PROVIDER_WAIT, QUOTA_RESET_UNKNOWN, NO_COMPATIBLE_PROVIDER, COST_UNKNOWN, POLICY_REVOKED, RETRY_EXHAUSTED, RESERVATION_UNKNOWN`. Comuni: UNSUPPORTED, FEATURE_NOT_INITIALIZED, INVALID_REQUEST, APPROVAL_REQUIRED, APPROVAL_STALE, IDEMPOTENCY_CONFLICT, RESOURCE_LIMIT, ARTIFACT_CORRUPT. Errori pubblici statici/codici/nextAction, senza raw stderr o segreti. Non rendere un fallimento esterno come successo locale.

## Confini ed effetti

Scheduler nel daemon con clock iniettabile, durable queue e token atomici nel writer; wake timers calcolati dallo stato persistito, nessun poll continuo quando idle.

Nessuna nuova mutazione Git; rispettare lease006 di un writer/workspace anche con più sessioni sullo stesso repository.

Sticky default; fallback solo verso adapter qualificato compatibile e autorizzato, dopo prova stop e checkpoint. Cost-aware usa solo stime esplicite datate e comparabili, altrimenti WAITING_USER.

Stati e campi delle prove: [data-model.md](../data-model.md). Dettagli di cap e regole crash/ownership nei contratti trasversali; limiti specifici: Default4run totali, Discovery≤1,install≤2,validate≤2,un writer/workspace;128pending;max3attempt/policy; min retry60s e backoff≤15min solo se autorizzato; CPU/RAM campionati≤1/5s solo con job, budget soft e stato esplicito.

## Desktop, eventi e prove

Main `apps/desktop/src/main/scheduler.ts` chiama CLI e salva ricevuta action/requestId/store/target prima dell’invio; shared DTO in `apps/desktop/src/shared/scheduler-contract.ts`, preload allowlist e renderer view senza accesso OS. Prepare/confirm mostra azione e ambito correnti; nessuna approvazione ricavata dal prompt. Disabilitare mutazioni offline; history disponibile con data. Epoch di archivio/target e revisioni scartano risultati tardivi.

Eventi `scheduler.changed`, `scheduler.output.available` dove applicabile: solo IDs/stato/codice/revisione/watermark; payload testo/diff/documento recuperato via pagina. Estendere core e desktop allowlist nello stesso incremento. Replay/ACK e limiti journal invariati. Test contract API/CLI/bridge e integrazione locale dimostrano validazione, idempotenza cross-namespace, stale grant, output/quote pieni e privacy.
