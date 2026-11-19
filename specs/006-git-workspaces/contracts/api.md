# Contract — Owned Git Workspaces v1

**Stato**: proposto per schema6. Non pubblicare capability finché implementazione e composizione non esistono. Eredita integralmente [contratti trasversali](../../../docs/missing-features-contracts.md) e i confini del trasporto001/002 e client003.

## Envelope, grant e letture

Namespace locale `workspace.*`, capability `workspaceVersion:1`; namespace canonico ledger `WORKSPACE`. `prepare {action,intent,expectedRevisions}` è comune; risponde grantId,canonicalIntentHash,summary,expiresAt. Le mutazioni consumano grant su intent conservato dal core con requestId UUID e revisioni; gli input indicati nella tabella sono il contenuto canonico da preparare e verificare, non campi facoltativi.

CLI `maestro workspace ... --state-dir ABS --json`; mutazioni con `--request-id UUID` e `--grant UUID` quando indicato. Input testuale tramite file/stdin bounded o artifactId sigillato; mai comandi shell, token o path privati forniti dal renderer. Metodi interni marcati internal non sono pubblicati via IPC/CLI. Nessun metodo di lettura può compiere inferenza, login, migrazione o cleanup.

`list/get`, `operation.get {requestId}`, `artifact.get {artifactId,cursor?}` e `output.list` dove applicabile: pagine metadata≤20 ed envelope≤32KiB, chunk8KiB raw con hash/base64, cursori store/target/revision-bound. `get` restituisce entityId,state,stateRevision,configRevision quando applicabile,freshness,checkedAt,safeError; riferimento a artefatto privato non espone path. LIST offline LAST_KNOWN; controlli attuali richiedono daemon e operazione esplicita.

## Metodi e risultati

Ogni metodo è sotto `workspace.`; sottosezioni mantengono associazione esplicita alla storia. `requestId` è obbligatorio per ogni mutazione, incluso refresh/configure/reconcile. Dove non è indicato grant: lettura pura o osservazione locale/remote esplicitamente richiesta senza ulteriore effetto; start/install/merge/push/deploy restano sempre soggetti a grant/policy core. Progetti/entità bersaglio rimossi o store differente sono rifiutati.

### US1 — Preparare un workspace da un piano approvato

| Metodo / CLI equivalente | Intent canonico / input | Risultato dopo admission o lettura |
|---|---|---|
| `create` | featureId,envelopeId,baseRef,baseOid,grantId | workspaceId,operationId |
| `list` | projectId,cursor? | workspace metadata |
| `get` | workspaceId | ownership,state,baseOid |

### US2 — Osservare, riservare e recuperare workspace

| Metodo / CLI equivalente | Intent canonico / input | Risultato dopo admission o lettura |
|---|---|---|
| `refresh` | workspaceId,expectedStateRevision,requestId | observationId,state |
| `operation.get` | requestId | phase,outcome |
| `lease.acquire (internal)` | workspaceId,holderId,generation | leaseId o WORKSPACE_IN_USE |

### US3 — Rimuovere soltanto un workspace sicuro

| Metodo / CLI equivalente | Intent canonico / input | Risultato dopo admission o lettura |
|---|---|---|
| `cleanup.prepare` | workspaceId,targetRef,targetOid | summary,grantId |
| `remove` | workspaceId,expectedStateRevision,grantId | operationId |
| `cleanup.get` | workspaceId | eligible,reason,evidence |

Regole specifiche di transizione, approvazione e recovery: [policy.md](policy.md).

## Validazione, completion ed errori

UUID validati, DTO chiusi, revisioni decimali positive, digest e enum allowlist; unknown field/command/flag rifiutato. Il risultato mutativo è `{accepted,requestId,entityId?,operationId?,stateRevision}` entro target2s. `operation.get` espone `{action,phase,outcome,acceptedAt,completedAt?,resultIds,safeError}`; stato operazione e lifecycle distinguibili. Stesso requestId/hash recupera il risultato originale; conflitto di intento/namespace → IDEMPOTENCY_CONFLICT. NOT_FOUND dopo un esito incerto non è autorizzazione a ripetere.

Lavoro lungo: admission asincrona, job con deadline e query; output paginato. Timeout non è prova di mancata esecuzione o uscita. Risposta persa → UNKNOWN_OUTCOME con UUID originale. Una nuova operazione può partire solo dopo riconciliazione o nuova autorizzazione pertinente.

Errori specifici: `WORKSPACE_LIMIT, BASE_CHANGED, BRANCH_EXISTS, WORKSPACE_IN_USE, OWNERSHIP_UNPROVEN, UNINTEGRATED_WORK, GIT_CONFLICT, REPOSITORY_CHANGED`. Comuni: UNSUPPORTED, FEATURE_NOT_INITIALIZED, INVALID_REQUEST, APPROVAL_REQUIRED, APPROVAL_STALE, IDEMPOTENCY_CONFLICT, RESOURCE_LIMIT, ARTIFACT_CORRUPT. Errori pubblici statici/codici/nextAction, senza raw stderr o segreti. Non rendere un fallimento esterno come successo locale.

## Confini ed effetti

Adapter Git mutativo nuovo dietro WorkspacePort, separato da repository-inspector readonly; binario Git Xcode pin del repository, argv allowlist, shell:false e profilo OS qualificato per le sole risorse possedute.

Lease per repositoryKey + controllo worktree/branch/anchor prima e dopo ogni effetto; niente --force, prune globale, reset o adozione implicita.

Nessun provider chiamato; workspace non è confine di sicurezza e non abilita l’esecuzione009.

Stati e campi delle prove: [data-model.md](../data-model.md). Dettagli di cap e regole crash/ownership nei contratti trasversali; limiti specifici: Max20worktree; provision/remove≤30s con timeout riconciliabile; output Git bounded; un mutatore per repositoryKey; path solo generati dal core.

## Desktop, eventi e prove

Main `apps/desktop/src/main/workspace.ts` chiama CLI e salva ricevuta action/requestId/store/target prima dell’invio; shared DTO in `apps/desktop/src/shared/workspace-contract.ts`, preload allowlist e renderer view senza accesso OS. Prepare/confirm mostra azione e ambito correnti; nessuna approvazione ricavata dal prompt. Disabilitare mutazioni offline; history disponibile con data. Epoch di archivio/target e revisioni scartano risultati tardivi.

Eventi `workspace.changed`, `workspace.output.available` dove applicabile: solo IDs/stato/codice/revisione/watermark; payload testo/diff/documento recuperato via pagina. Estendere core e desktop allowlist nello stesso incremento. Replay/ACK e limiti journal invariati. Test contract API/CLI/bridge e integrazione locale dimostrano validazione, idempotenza cross-namespace, stale grant, output/quote pieni e privacy.
