# Contract — Release Publishing, Pull Requests & Deployment Gates v1

**Stato**: proposto per schema12. Non pubblicare capability finché implementazione e composizione non esistono. Eredita integralmente [contratti trasversali](../../../docs/missing-features-contracts.md) e i confini del trasporto001/002 e client003.

## Envelope, grant e letture

Namespace locale `release.*`, capability `releaseVersion:1`; namespace canonico ledger `RELEASE`. `prepare {action,intent,expectedRevisions}` è comune; risponde grantId,canonicalIntentHash,summary,expiresAt. Le mutazioni consumano grant su intent conservato dal core con requestId UUID e revisioni; gli input indicati nella tabella sono il contenuto canonico da preparare e verificare, non campi facoltativi.

CLI `maestro release ... --state-dir ABS --json`; mutazioni con `--request-id UUID` e `--grant UUID` quando indicato. Input testuale tramite file/stdin bounded o artifactId sigillato; mai comandi shell, token o path privati forniti dal renderer. Metodi interni marcati internal non sono pubblicati via IPC/CLI. Nessun metodo di lettura può compiere inferenza, login, migrazione o cleanup.

`list/get`, `operation.get {requestId}`, `artifact.get {artifactId,cursor?}` e `output.list` dove applicabile: pagine metadata≤20 ed envelope≤32KiB, chunk8KiB raw con hash/base64, cursori store/target/revision-bound. `get` restituisce entityId,state,stateRevision,configRevision quando applicabile,freshness,checkedAt,safeError; riferimento a artefatto privato non espone path. LIST offline LAST_KNOWN; controlli attuali richiedono daemon e operazione esplicita.

## Metodi e risultati

Ogni metodo è sotto `release.`; sottosezioni mantengono associazione esplicita alla storia. `requestId` è obbligatorio per ogni mutazione, incluso refresh/configure/reconcile. Dove non è indicato grant: lettura pura o osservazione locale/remote esplicitamente richiesta senza ulteriore effetto; start/install/merge/push/deploy restano sempre soggetti a grant/policy core. Progetti/entità bersaglio rimossi o store differente sono rifiutati.

### US1 — Approvare e pubblicare un commit integrato

| Metodo / CLI equivalente | Intent canonico / input | Risultato dopo admission o lettura |
|---|---|---|
| `plan` | integrationId,remoteId,targetRef,mode,requestId | releaseId,planDigest |
| `publish` | releaseId,planDigest,grantId | operationId |
| `reconcile` | releaseId,requestId | remoteEvidence,outcome |
| `tag` | releaseId,tagName,sourceOid,grantId | tagProof (optional) |

### US2 — Aprire una PR e seguire la CI del commit corretto

| Metodo / CLI equivalente | Intent canonico / input | Risultato dopo admission o lettura |
|---|---|---|
| `pr.prepare` | releaseId,baseRef,headRef,bodyArtifactId | summary,grantId |
| `pr.create` | releaseId,planDigest,grantId | prId,url |
| `ci.refresh` | releaseId,commitOid,requestId | observationId,status |
| `get` | releaseId | local/push/pr/ci states |

### US3 — Autorizzare deployment e automazioni limitate

| Metodo / CLI equivalente | Intent canonico / input | Risultato dopo admission o lettura |
|---|---|---|
| `deploy.plan` | releaseId,artifactDigest,environmentId,adapterRevision,requestId | deploymentId,planDigest |
| `deploy` | deploymentId,planDigest,grantId | jobId |
| `policy.configure` | scope,limits,expiresAt,grantId | policyId,revision |
| `policy.revoke` | policyId,expectedRevision,grantId | revokedRevision |
| `deployment.get` | deploymentId | status,evidence |

Regole specifiche di transizione, approvazione e recovery: [policy.md](policy.md).

## Validazione, completion ed errori

UUID validati, DTO chiusi, revisioni decimali positive, digest e enum allowlist; unknown field/command/flag rifiutato. Il risultato mutativo è `{accepted,requestId,entityId?,operationId?,stateRevision}` entro target2s. `operation.get` espone `{action,phase,outcome,acceptedAt,completedAt?,resultIds,safeError}`; stato operazione e lifecycle distinguibili. Stesso requestId/hash recupera il risultato originale; conflitto di intento/namespace → IDEMPOTENCY_CONFLICT. NOT_FOUND dopo un esito incerto non è autorizzazione a ripetere.

Lavoro lungo: admission asincrona, job con deadline e query; output paginato. Timeout non è prova di mancata esecuzione o uscita. Risposta persa → UNKNOWN_OUTCOME con UUID originale. Una nuova operazione può partire solo dopo riconciliazione o nuova autorizzazione pertinente.

Errori specifici: `REMOTE_CHANGED, REMOTE_AUTH_REQUIRED, BRANCH_PROTECTED, PUBLICATION_APPROVAL_REQUIRED, REMOTE_OUTCOME_UNKNOWN, HOSTING_UNSUPPORTED, CI_UNKNOWN, DEPLOYMENT_APPROVAL_REQUIRED, ENVIRONMENT_CHANGED, POLICY_REVOKED`. Comuni: UNSUPPORTED, FEATURE_NOT_INITIALIZED, INVALID_REQUEST, APPROVAL_REQUIRED, APPROVAL_STALE, IDEMPOTENCY_CONFLICT, RESOURCE_LIMIT, ARTIFACT_CORRUPT. Errori pubblici statici/codici/nextAction, senza raw stderr o segreti. Non rendere un fallimento esterno come successo locale.

## Confini ed effetti

GitPublicationPort dietro adapter macOS e RemoteWorkflowPort per PR/CI/deploy. Primo provider hosting qualificabile GitHub con CLI gh esterna pin/hash/auth helper supportati; altri hosting tramite Git-only e handoff manuale, senza nuova dipendenza runtime.

Origin URL canonico e scope verificati prima del consenso; push solo refspec esplicito e commit approvato, no --force, no wildcard, nessun checkout user mutato. Network e credential helper nel solo processo pubblicazione trusted.

Release Manager suggerisce testo/piano tramite profilo009 autorizzato ma non pubblica dal proprio shell. Git/hosting auth ufficiale è distinta da provider AI e non risolve004.

Stati e campi delle prove: [data-model.md](../data-model.md). Dettagli di cap e regole crash/ownership nei contratti trasversali; limiti specifici: Push/PR/CI request≤60s, deploy≤10min configurable in preview; output cap comuni; max20CIobservations/release in cache metadata latest bounded con storico eventi, no polling quando UI chiusa salvo job follow esplicito; no network from history.

## Desktop, eventi e prove

Main `apps/desktop/src/main/release.ts` chiama CLI e salva ricevuta action/requestId/store/target prima dell’invio; shared DTO in `apps/desktop/src/shared/release-contract.ts`, preload allowlist e renderer view senza accesso OS. Prepare/confirm mostra azione e ambito correnti; nessuna approvazione ricavata dal prompt. Disabilitare mutazioni offline; history disponibile con data. Epoch di archivio/target e revisioni scartano risultati tardivi.

Eventi `release.changed`, `release.output.available` dove applicabile: solo IDs/stato/codice/revisione/watermark; payload testo/diff/documento recuperato via pagina. Estendere core e desktop allowlist nello stesso incremento. Replay/ACK e limiti journal invariati. Test contract API/CLI/bridge e integrazione locale dimostrano validazione, idempotenza cross-namespace, stale grant, output/quote pieni e privacy.
