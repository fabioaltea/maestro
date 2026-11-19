# Data Model — Session Scheduling, Quotas & Provider Policies

**Schema proposto**: 10 cumulativo dopo9; nessuna tabella implementata da questa pianificazione. Identità UUID, revisioni decimali stringa, timestamp UTC e digest SHA256 come nella base.

## Entità e relazioni

| Entità | Campi, relazioni e validazione |
|---|---|
| ScheduledJob | jobId,projectId,sessionId?,type DISCOVERY/EXECUTION/INSTALL/VALIDATE,priority,queuedAt,notBefore,state,stateRevision,idempotencyKey; max128pending |
| ResourcePolicy | policyId,revision,globalRuns=4,install=2,validation=2,perProjectWeight,softCpu/Ram/DiskLimits,approvedAt; override scoped |
| ResourceReservation | reservationId,jobId,generation,slotClass,workspaceLeaseId,processProof,releaseState; unknown conserva debit |
| ProviderWait | waitId,sessionId,providerId,reason,observedAt,resetAt?,source,expiresAt?,retryBudget; null reset resta ignoto |
| ProviderPolicy | policyId,revision,mode STICKY/FALLBACK/COST_AWARE,orderedProviderRefs,requiredCapabilities,maxAttempts=3,costCeiling?,costEstimateRefs,scope,revokedAt |
| SwitchDecision | decisionId,sessionId,fromRunId,checkpointId,toProviderId,policyRevision,compatibilityDigest,reason,grantId?,outcome; un nuovo run |

Tutte le righe hanno storeId e riferimenti projectId/featureId applicabili; FK impediscono riferimenti ad altri store o revisioni di altra entità. Configurazioni e approvazioni sono append-only; disabilitazione/tombstone non cancella dati referenziati. Per le associazioni esterne usare ID opachi e digest, mai token o path del client come autorità.

## Tabelle e commit

Persistenza in `src/storage/scheduler-schema.ts` e `scheduler-store.ts`, tabelle prefissate `scheduler_`. Mappare una tabella per le entità sopra e tabelle join per riferimenti multivalore; indici unici su ID, (parentId,revision) e chiavi di idempotenza. Una revisione non cambia contenuto dopo seal. Update di stato usa CAS expectedStateRevision, incrementa revisione ed emette outbox nella stessa transazione.

Non creare un secondo ledger: `workflow_operations`/grant/artefatti comuni sono introdotti005. Le operazioni di questo modulo usano il namespace canonico specificato nel contratto API, requestId e hash dell’intent. UUID globali devono essere esclusivi anche nei ledger preesistenti. Riferimenti a oggetti solo dopo seal/fsync/hash; reservation conteggiata finché reconcile o discard sicuro dimostrano la liberazione.

## State Transitions

Job QUEUED → RESERVED → RUNNING → SUCCEEDED/FAILED/CANCELLED; indisponibilità → WAITING_PROVIDER/WAITING_USER, budget → WAITING_RESOURCE; owner incerto → RECONCILING con reservation. Switch PLANNED → AUTHORIZED → STARTED solo dopo uscita vecchio run e checkpoint corrente; revoca blocca le nuove admission.

Stato operazione e stato dell’entità sono distinti: admission riuscita non implica workflow concluso. Un processo/evento di generation superata non modifica l’entità corrente. Esito remoto o uscita processo non provati restano UNKNOWN/RECONCILING con debit/lease, non terminali di successo.

## Invarianti e autorizzazioni

- Revisioni/config/digest nell’intent devono coincidere con snapshot approvato e stato corrente prima dell’effetto. La verifica filesystem richiede observation e controllo finale, non una transazione globale immaginaria.
- Nessuna nuova mutazione Git; rispettare lease006 di un writer/workspace anche con più sessioni sullo stesso repository.
- Sticky default; fallback solo verso adapter qualificato compatibile e autorizzato, dopo prova stop e checkpoint. Cost-aware usa solo stime esplicite datate e comparabili, altrimenti WAITING_USER.
- Relazioni con entità storiche conservate; rimozione solo senza riferimenti e senza lavoro/processi/effetti incerti.
- Default4run totali, Discovery≤1,install≤2,validate≤2,un writer/workspace;128pending;max3attempt/policy; min retry60s e backoff≤15min solo se autorizzato; CPU/RAM campionati≤1/5s solo con job, budget soft e stato esplicito.
- Quota e riserva terminale come [contratti trasversali](../../docs/missing-features-contracts.md); query/cancel/recovery disponibili a saturazione, niente eviction automatica di dati irrisolti.

## Recovery e schema

Testare fault prima/dopo commit di upgrade e ogni pubblicazione artefatto/effetto delle storie. Reader storico immutabile; offline freshness LAST_KNOWN e eligibility=false/UNKNOWN. Riconciliare identità archive, FK, riferimenti/hash e prove esterne prima di rilasciare risorse. Se prova assente o ambigua, preservare i dati e rendere il blocco interrogabile con requestId originale.
