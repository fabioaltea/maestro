# Data Model — Review, Validation & Safe Local Merge

**Schema proposto**: 11 cumulativo dopo10; nessuna tabella implementata da questa pianificazione. Identità UUID, revisioni decimali stringa, timestamp UTC e digest SHA256 come nella base.

## Entità e relazioni

| Entità | Campi, relazioni e validazione |
|---|---|
| ReviewSnapshot | reviewId,featureRevisionId,sourceCheckpointId,sourceHeadOid,sourceTreeDigest,targetRef,targetOid,diffArtifactId,criteriaRevision,validationRefs,documentationRefs,digest,stateRevision |
| ValidationEvidence | evidenceId,reviewId,criterionId,jobId,inputTreeDigest,commandSpecDigest,result PASS/FAIL/NOT_RUN/BLOCKED,outputRef,checkedAt; nessun skip→PASS |
| ReviewDecision | decisionId,reviewDigest,ownerUid,decision REQUEST_CHANGES/APPROVE_INTEGRATION,acceptedLimitations,approvedAt |
| IntegrationCandidate | candidateId,reviewId,parentSourceOid,parentTargetOid,candidateOid,candidateTreeOid,stagingWorkspaceId,guardWorkspaceId,validationRefs,digest |
| IntegrationOperation | integrationId,requestId,candidateId,expectedTargetOid,targetRef,phase,state REF_INTENT/REF_UPDATED/GUARD_SYNCED/FINALIZED/RECONCILING,resultingOid,proofRefs |

Tutte le righe hanno storeId e riferimenti projectId/featureId applicabili; FK impediscono riferimenti ad altri store o revisioni di altra entità. Configurazioni e approvazioni sono append-only; disabilitazione/tombstone non cancella dati referenziati. Per le associazioni esterne usare ID opachi e digest, mai token o path del client come autorità.

## Tabelle e commit

Persistenza in `src/storage/review-schema.ts` e `review-store.ts`, tabelle prefissate `review_`. Mappare una tabella per le entità sopra e tabelle join per riferimenti multivalore; indici unici su ID, (parentId,revision) e chiavi di idempotenza. Una revisione non cambia contenuto dopo seal. Update di stato usa CAS expectedStateRevision, incrementa revisione ed emette outbox nella stessa transazione.

Non creare un secondo ledger: `workflow_operations`/grant/artefatti comuni sono introdotti005. Le operazioni di questo modulo usano il namespace canonico specificato nel contratto API, requestId e hash dell’intent. UUID globali devono essere esclusivi anche nei ledger preesistenti. Riferimenti a oggetti solo dopo seal/fsync/hash; reservation conteggiata finché reconcile o discard sicuro dimostrano la liberazione.

## State Transitions

Review DRAFT → CHECKING → CHANGES_REQUESTED/READY_FOR_APPROVAL/BLOCKED → APPROVED; input modificato → STALE. Integrazione PREPARING → CONFLICT/READY → REF_INTENT → REF_UPDATED → NEEDS_RECONCILE/GUARD_SYNCED → INTEGRATED; unknown mai remerge. Pulizia separata006.

Stato operazione e stato dell’entità sono distinti: admission riuscita non implica workflow concluso. Un processo/evento di generation superata non modifica l’entità corrente. Esito remoto o uscita processo non provati restano UNKNOWN/RECONCILING con debit/lease, non terminali di successo.

## Invarianti e autorizzazioni

- Revisioni/config/digest nell’intent devono coincidere con snapshot approvato e stato corrente prima dell’effetto. La verifica filesystem richiede observation e controllo finale, non una transazione globale immaginaria.
- Candidate in staging detached posseduto; target deve essere libero e riservato dal guard worktree core. Update-ref con oldOid atteso; niente checkout/merge/reset nel checkout dell’utente.
- Reviewer assistito opzionale tramite009 con scope readonly qualificato; commenti AI non conferiscono autorizzazione e non sostituiscono prove dei criteri.
- Relazioni con entità storiche conservate; rimozione solo senza riferimenti e senza lavoro/processi/effetti incerti.
- Max100file/2MiB diff visualizzabile per snapshot; eccedenza blocca approvazione finché scope review non coperto; candidate/preflight≤30s, check job≤5min ciascuno; mutation target una per repository.
- Quota e riserva terminale come [contratti trasversali](../../docs/missing-features-contracts.md); query/cancel/recovery disponibili a saturazione, niente eviction automatica di dati irrisolti.

## Recovery e schema

Testare fault prima/dopo commit di upgrade e ogni pubblicazione artefatto/effetto delle storie. Reader storico immutabile; offline freshness LAST_KNOWN e eligibility=false/UNKNOWN. Riconciliare identità archive, FK, riferimenti/hash e prove esterne prima di rilasciare risorse. Se prova assente o ambigua, preservare i dati e rendere il blocco interrogabile con requestId originale.
