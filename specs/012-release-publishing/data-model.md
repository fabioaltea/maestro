# Data Model — Release Publishing, Pull Requests & Deployment Gates

**Schema proposto**: 12 cumulativo dopo11; nessuna tabella implementata da questa pianificazione. Identità UUID, revisioni decimali stringa, timestamp UTC e digest SHA256 come nella base.

## Entità e relazioni

| Entità | Campi, relazioni e validazione |
|---|---|
| ReleasePlan | releaseId,projectId,integrationReceiptId,sourceOid,remoteId,remoteUrlDigest,targetRef,expectedRemoteOid,mode DIRECT/PR,tagPlan?,artifactDigest,stateRevision |
| PublicationGrant | approvalId,releasePlanDigest,action PUSH/CREATE_PR/CREATE_TAG,remoteUrlDigest,refspec,sourceOid,expectedRemoteOid,ownerUid,approvedAt; distinto dal grant DEPLOY |
| RemoteEffect | effectId,requestId,kind,payloadDigest,remoteIdentity,idempotencyMarker,externalId?,beforeEvidence,afterEvidence,outcome; UNKNOWN conserva ambiguità |
| CIObservation | observationId,releaseId,providerId,externalRunId,commitOid,status,conclusion?,observedAt,freshness; check assente non è successo |
| DeploymentPlan | deploymentId,releaseId,sourceOid,artifactDigest,environmentId,adapterRevision,commandSpecId,expectedEnvironmentRevision,policyRevision?,status; target ambiente distinto dal remote Git |
| AutomaticReleasePolicy | policyId,revision,allowedActions,remote/environment/refScope,artifactConstraints,maxUses,expiresAt,revokedAt; default assente/manuale |

Tutte le righe hanno storeId e riferimenti projectId/featureId applicabili; FK impediscono riferimenti ad altri store o revisioni di altra entità. Configurazioni e approvazioni sono append-only; disabilitazione/tombstone non cancella dati referenziati. Per le associazioni esterne usare ID opachi e digest, mai token o path del client come autorità.

## Tabelle e commit

Persistenza in `src/storage/release-schema.ts` e `release-store.ts`, tabelle prefissate `release_`. Mappare una tabella per le entità sopra e tabelle join per riferimenti multivalore; indici unici su ID, (parentId,revision) e chiavi di idempotenza. Una revisione non cambia contenuto dopo seal. Update di stato usa CAS expectedStateRevision, incrementa revisione ed emette outbox nella stessa transazione.

Non creare un secondo ledger: `workflow_operations`/grant/artefatti comuni sono introdotti005. Le operazioni di questo modulo usano il namespace canonico specificato nel contratto API, requestId e hash dell’intent. UUID globali devono essere esclusivi anche nei ledger preesistenti. Riferimenti a oggetti solo dopo seal/fsync/hash; reservation conteggiata finché reconcile o discard sicuro dimostrano la liberazione.

## State Transitions

Release DRAFT → READY_FOR_APPROVAL → PUBLISHING → PUBLISHED/PR_OPEN/WAITING_CI/BLOCKED/REMOTE_UNKNOWN. CI PENDING/RUNNING/SUCCEEDED/FAILED/UNKNOWN. Deploy PLANNED → WAITING_APPROVAL → RUNNING → SUCCEEDED/FAILED/UNKNOWN; push non porta a DEPLOYED. Retry solo dopo riconciliazione dell’effetto remoto.

Stato operazione e stato dell’entità sono distinti: admission riuscita non implica workflow concluso. Un processo/evento di generation superata non modifica l’entità corrente. Esito remoto o uscita processo non provati restano UNKNOWN/RECONCILING con debit/lease, non terminali di successo.

## Invarianti e autorizzazioni

- Revisioni/config/digest nell’intent devono coincidere con snapshot approvato e stato corrente prima dell’effetto. La verifica filesystem richiede observation e controllo finale, non una transazione globale immaginaria.
- Origin URL canonico e scope verificati prima del consenso; push solo refspec esplicito e commit approvato, no --force, no wildcard, nessun checkout user mutato. Network e credential helper nel solo processo pubblicazione trusted.
- Release Manager suggerisce testo/piano tramite profilo009 autorizzato ma non pubblica dal proprio shell. Git/hosting auth ufficiale è distinta da provider AI e non risolve004.
- Relazioni con entità storiche conservate; rimozione solo senza riferimenti e senza lavoro/processi/effetti incerti.
- Push/PR/CI request≤60s, deploy≤10min configurable in preview; output cap comuni; max20CIobservations/release in cache metadata latest bounded con storico eventi, no polling quando UI chiusa salvo job follow esplicito; no network from history.
- Quota e riserva terminale come [contratti trasversali](../../docs/missing-features-contracts.md); query/cancel/recovery disponibili a saturazione, niente eviction automatica di dati irrisolti.

## Recovery e schema

Testare fault prima/dopo commit di upgrade e ogni pubblicazione artefatto/effetto delle storie. Reader storico immutabile; offline freshness LAST_KNOWN e eligibility=false/UNKNOWN. Riconciliare identità archive, FK, riferimenti/hash e prove esterne prima di rilasciare risorse. Se prova assente o ambigua, preservare i dati e rendere il blocco interrogabile con requestId originale.
