# Contract — Review, Validation & Safe Local Merge v1

**Stato**: proposto per schema11. Non pubblicare capability finché implementazione e composizione non esistono. Eredita integralmente [contratti trasversali](../../../docs/missing-features-contracts.md) e i confini del trasporto001/002 e client003.

## Envelope, grant e letture

Namespace locale `review.*`, capability `reviewVersion:1`; namespace canonico ledger `REVIEW`. `prepare {action,intent,expectedRevisions}` è comune; risponde grantId,canonicalIntentHash,summary,expiresAt. Le mutazioni consumano grant su intent conservato dal core con requestId UUID e revisioni; gli input indicati nella tabella sono il contenuto canonico da preparare e verificare, non campi facoltativi.

CLI `maestro review ... --state-dir ABS --json`; mutazioni con `--request-id UUID` e `--grant UUID` quando indicato. Input testuale tramite file/stdin bounded o artifactId sigillato; mai comandi shell, token o path privati forniti dal renderer. Metodi interni marcati internal non sono pubblicati via IPC/CLI. Nessun metodo di lettura può compiere inferenza, login, migrazione o cleanup.

`list/get`, `operation.get {requestId}`, `artifact.get {artifactId,cursor?}` e `output.list` dove applicabile: pagine metadata≤20 ed envelope≤32KiB, chunk8KiB raw con hash/base64, cursori store/target/revision-bound. `get` restituisce entityId,state,stateRevision,configRevision quando applicabile,freshness,checkedAt,safeError; riferimento a artefatto privato non espone path. LIST offline LAST_KNOWN; controlli attuali richiedono daemon e operazione esplicita.

## Metodi e risultati

Ogni metodo è sotto `review.`; sottosezioni mantengono associazione esplicita alla storia. `requestId` è obbligatorio per ogni mutazione, incluso refresh/configure/reconcile. Dove non è indicato grant: lettura pura o osservazione locale/remote esplicitamente richiesta senza ulteriore effetto; start/install/merge/push/deploy restano sempre soggetti a grant/policy core. Progetti/entità bersaglio rimossi o store differente sono rifiutati.

### US1 — Revisionare diff, criteri e controlli correnti

| Metodo / CLI equivalente | Intent canonico / input | Risultato dopo admission o lettura |
|---|---|---|
| `create` | featureId,checkpointId,targetRef,targetOid,grantId | reviewId,digest |
| `validate` | reviewId,commandSpecIds,grantId | jobIds |
| `request-changes` | reviewId,feedbackArtifactId,grantId | decisionId |
| `get` | reviewId | criteria,evidence,diffMetadata |

### US2 — Approvare e integrare un candidate locale sicuro

| Metodo / CLI equivalente | Intent canonico / input | Risultato dopo admission o lettura |
|---|---|---|
| `candidate.prepare` | reviewId,expectedStateRevision,grantId | candidateId,candidateOid,state |
| `approve` | reviewId,candidateId,evidenceDigest,grantId | decisionId |
| `integrate` | candidateId,decisionId,expectedTargetOid,grantId | integrationId,operationId |
| `operation.get` | requestId | phase,proof,resultingOid |

### US3 — Concludere review e aggiornare contesto e risorse

| Metodo / CLI equivalente | Intent canonico / input | Risultato dopo admission o lettura |
|---|---|---|
| `complete` | integrationId,expectedStateRevision,requestId | receiptId,contextFreshness |
| `receipt.get` | integrationId | source/candidate/target/proofs |
| `cleanup.preview` | integrationId,workspaceId | eligibility,reason (delegated006) |

Regole specifiche di transizione, approvazione e recovery: [policy.md](policy.md).

## Validazione, completion ed errori

UUID validati, DTO chiusi, revisioni decimali positive, digest e enum allowlist; unknown field/command/flag rifiutato. Il risultato mutativo è `{accepted,requestId,entityId?,operationId?,stateRevision}` entro target2s. `operation.get` espone `{action,phase,outcome,acceptedAt,completedAt?,resultIds,safeError}`; stato operazione e lifecycle distinguibili. Stesso requestId/hash recupera il risultato originale; conflitto di intento/namespace → IDEMPOTENCY_CONFLICT. NOT_FOUND dopo un esito incerto non è autorizzazione a ripetere.

Lavoro lungo: admission asincrona, job con deadline e query; output paginato. Timeout non è prova di mancata esecuzione o uscita. Risposta persa → UNKNOWN_OUTCOME con UUID originale. Una nuova operazione può partire solo dopo riconciliazione o nuova autorizzazione pertinente.

Errori specifici: `REVIEW_STALE, CHECKS_FAILED, CHECKS_NOT_RUN, TARGET_IN_USE, TARGET_MOVED, MERGE_CONFLICT, SOURCE_NOT_QUIESCENT, CANDIDATE_CHANGED, INTEGRATION_UNKNOWN`. Comuni: UNSUPPORTED, FEATURE_NOT_INITIALIZED, INVALID_REQUEST, APPROVAL_REQUIRED, APPROVAL_STALE, IDEMPOTENCY_CONFLICT, RESOURCE_LIMIT, ARTIFACT_CORRUPT. Errori pubblici statici/codici/nextAction, senza raw stderr o segreti. Non rendere un fallimento esterno come successo locale.

## Confini ed effetti

ReviewSnapshot dal core, EnvironmentJobPort per check, ReviewPort per lettura diff/test e GitIntegrationPort per candidate/CAS; nessun SDK o motore di merge esterno.

Candidate in staging detached posseduto; target deve essere libero e riservato dal guard worktree core. Update-ref con oldOid atteso; niente checkout/merge/reset nel checkout dell’utente.

Reviewer assistito opzionale tramite009 con scope readonly qualificato; commenti AI non conferiscono autorizzazione e non sostituiscono prove dei criteri.

Stati e campi delle prove: [data-model.md](../data-model.md). Dettagli di cap e regole crash/ownership nei contratti trasversali; limiti specifici: Max100file/2MiB diff visualizzabile per snapshot; eccedenza blocca approvazione finché scope review non coperto; candidate/preflight≤30s, check job≤5min ciascuno; mutation target una per repository.

## Desktop, eventi e prove

Main `apps/desktop/src/main/review.ts` chiama CLI e salva ricevuta action/requestId/store/target prima dell’invio; shared DTO in `apps/desktop/src/shared/review-contract.ts`, preload allowlist e renderer view senza accesso OS. Prepare/confirm mostra azione e ambito correnti; nessuna approvazione ricavata dal prompt. Disabilitare mutazioni offline; history disponibile con data. Epoch di archivio/target e revisioni scartano risultati tardivi.

Eventi `review.changed`, `review.output.available` dove applicabile: solo IDs/stato/codice/revisione/watermark; payload testo/diff/documento recuperato via pagina. Estendere core e desktop allowlist nello stesso incremento. Replay/ACK e limiti journal invariati. Test contract API/CLI/bridge e integrazione locale dimostrano validazione, idempotenza cross-namespace, stale grant, output/quote pieni e privacy.
