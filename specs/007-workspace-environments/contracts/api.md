# Contract — Workspace Environments & Dependencies v1

**Stato**: proposto per schema7. Non pubblicare capability finché implementazione e composizione non esistono. Eredita integralmente [contratti trasversali](../../../docs/missing-features-contracts.md) e i confini del trasporto001/002 e client003.

## Envelope, grant e letture

Namespace locale `environment.*`, capability `environmentVersion:1`; namespace canonico ledger `ENVIRONMENT`. `prepare {action,intent,expectedRevisions}` è comune; risponde grantId,canonicalIntentHash,summary,expiresAt. Le mutazioni consumano grant su intent conservato dal core con requestId UUID e revisioni; gli input indicati nella tabella sono il contenuto canonico da preparare e verificare, non campi facoltativi.

CLI `maestro environment ... --state-dir ABS --json`; mutazioni con `--request-id UUID` e `--grant UUID` quando indicato. Input testuale tramite file/stdin bounded o artifactId sigillato; mai comandi shell, token o path privati forniti dal renderer. Metodi interni marcati internal non sono pubblicati via IPC/CLI. Nessun metodo di lettura può compiere inferenza, login, migrazione o cleanup.

`list/get`, `operation.get {requestId}`, `artifact.get {artifactId,cursor?}` e `output.list` dove applicabile: pagine metadata≤20 ed envelope≤32KiB, chunk8KiB raw con hash/base64, cursori store/target/revision-bound. `get` restituisce entityId,state,stateRevision,configRevision quando applicabile,freshness,checkedAt,safeError; riferimento a artefatto privato non espone path. LIST offline LAST_KNOWN; controlli attuali richiedono daemon e operazione esplicita.

## Metodi e risultati

Ogni metodo è sotto `environment.`; sottosezioni mantengono associazione esplicita alla storia. `requestId` è obbligatorio per ogni mutazione, incluso refresh/configure/reconcile. Dove non è indicato grant: lettura pura o osservazione locale/remote esplicitamente richiesta senza ulteriore effetto; start/install/merge/push/deploy restano sempre soggetti a grant/policy core. Progetti/entità bersaglio rimossi o store differente sono rifiutati.

### US1 — Rilevare e approvare il piano d’ambiente

| Metodo / CLI equivalente | Intent canonico / input | Risultato dopo admission o lettura |
|---|---|---|
| `plan` | workspaceId,expectedStateRevision,requestId | planId,digest,MANUAL_REQUIRED? |
| `attest` | workspaceId,inputDigest,limitations,grantId | attestationId |
| `get` | workspaceId | state,plan,currentness |

### US2 — Preparare dipendenze isolate

| Metodo / CLI equivalente | Intent canonico / input | Risultato dopo admission o lettura |
|---|---|---|
| `prepare` | planId,planDigest,grantId | jobId,operationId |
| `cancel` | jobId,expectedStateRevision,grantId | CANCELLING |
| `output.list` | jobId,cursor? | chunks,watermark,truncated |

### US3 — Eseguire controlli e recuperare i job

| Metodo / CLI equivalente | Intent canonico / input | Risultato dopo admission o lettura |
|---|---|---|
| `validate` | environmentId,commandSpecId,inputDigest,grantId | jobId |
| `job.get` | jobId | outcome,exitProof,inputDigest |
| `reconcile` | jobId,expectedStateRevision,requestId | state,evidence |

Regole specifiche di transizione, approvazione e recovery: [policy.md](policy.md).

## Validazione, completion ed errori

UUID validati, DTO chiusi, revisioni decimali positive, digest e enum allowlist; unknown field/command/flag rifiutato. Il risultato mutativo è `{accepted,requestId,entityId?,operationId?,stateRevision}` entro target2s. `operation.get` espone `{action,phase,outcome,acceptedAt,completedAt?,resultIds,safeError}`; stato operazione e lifecycle distinguibili. Stesso requestId/hash recupera il risultato originale; conflitto di intento/namespace → IDEMPOTENCY_CONFLICT. NOT_FOUND dopo un esito incerto non è autorizzazione a ripetere.

Lavoro lungo: admission asincrona, job con deadline e query; output paginato. Timeout non è prova di mancata esecuzione o uscita. Risposta persa → UNKNOWN_OUTCOME con UUID originale. Una nuova operazione può partire solo dopo riconciliazione o nuova autorizzazione pertinente.

Errori specifici: `MANAGER_UNSUPPORTED, MANAGER_MISMATCH, ENVIRONMENT_STALE, LOCKFILE_CHANGED, SCRIPT_APPROVAL_REQUIRED, CONFIG_UNSAFE, DISK_BUDGET, JOB_RECONCILING`. Comuni: UNSUPPORTED, FEATURE_NOT_INITIALIZED, INVALID_REQUEST, APPROVAL_REQUIRED, APPROVAL_STALE, IDEMPOTENCY_CONFLICT, RESOURCE_LIMIT, ARTIFACT_CORRUPT. Errori pubblici statici/codici/nextAction, senza raw stderr o segreti. Non rendere un fallimento esterno come successo locale.

## Confini ed effetti

EnvironmentPort e adapter pnpm su binario esterno versionato/hash qualificato; API native Node, nessun package runtime nuovo. Store Maestro condiviso e virtual store per workspace; clone-or-copy dove supportato e provato.

Preparazione scrive solo workspace posseduto e store dedicato; lockfile e manifest restano invariati in modalità frozen; niente Git mutations.

Nessun provider; script/installazioni sono esecuzione di codice con autorizzazione distinta dal piano feature.

Stati e campi delle prove: [data-model.md](../data-model.md). Dettagli di cap e regole crash/ownership nei contratti trasversali; limiti specifici: Install/validate max5min ciascuno; input config totale1MiB/200file; budget10GiB/workspace20GiBtotale, free<2GiB blocca; max2job solo quando010 disponibile, prima1.

## Desktop, eventi e prove

Main `apps/desktop/src/main/environment.ts` chiama CLI e salva ricevuta action/requestId/store/target prima dell’invio; shared DTO in `apps/desktop/src/shared/environment-contract.ts`, preload allowlist e renderer view senza accesso OS. Prepare/confirm mostra azione e ambito correnti; nessuna approvazione ricavata dal prompt. Disabilitare mutazioni offline; history disponibile con data. Epoch di archivio/target e revisioni scartano risultati tardivi.

Eventi `environment.changed`, `environment.output.available` dove applicabile: solo IDs/stato/codice/revisione/watermark; payload testo/diff/documento recuperato via pagina. Estendere core e desktop allowlist nello stesso incremento. Replay/ACK e limiti journal invariati. Test contract API/CLI/bridge e integrazione locale dimostrano validazione, idempotenza cross-namespace, stale grant, output/quote pieni e privacy.
