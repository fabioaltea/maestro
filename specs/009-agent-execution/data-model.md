# Data Model — Agent Sessions, Runs & Portable Checkpoints

**Schema proposto**: 9 cumulativo dopo8; nessuna tabella implementata da questa pianificazione. Identità UUID, revisioni decimali stringa, timestamp UTC e digest SHA256 come nella base.

## Entità e relazioni

| Entità | Campi, relazioni e validazione |
|---|---|
| ExecutionSession | sessionId,featureId,workspaceId,profileResolutionId,state,stateRevision,currentRunId,checkpointId,createdAt; più sessioni per feature, un writer/workspace |
| ExecutionRun | runId,sessionId,generation,executionEnvelopeDigest,providerId/model/configRevision,attempt,outcome,startedAt,endedAt,outputWatermark; ogni resume è nuovo run |
| ExecutionEnvelope | envelopeId,featureApprovalId,workspaceGeneration,inputTreeDigest,environmentPlanDigest,profileDigest,capabilityDigest,allowedTools,networkScope,resourceBudget,digest |
| ExecutionProcess | runId,generation,hostIdentity,owningInstanceId,challengeRef,observation,exitProof,releaseState; distinto da managed_resources Foundation |
| PortableCheckpoint | checkpointId,featureRevisionId,runId,inputTreeDigest,currentTreeDigest,patchArtifactId,commitOids,completedCriteria,pendingItems,validationRefs,knownLimitations,digest; facts verificabili vs note agente |
| ExecutionInteraction | interactionId,runId,generation,type QUESTION/TOOL_REQUEST,textArtifactId,requestedScope,status; nessun tool consentito dal solo testo |

Tutte le righe hanno storeId e riferimenti projectId/featureId applicabili; FK impediscono riferimenti ad altri store o revisioni di altra entità. Configurazioni e approvazioni sono append-only; disabilitazione/tombstone non cancella dati referenziati. Per le associazioni esterne usare ID opachi e digest, mai token o path del client come autorità.

## Tabelle e commit

Persistenza in `src/storage/execution-schema.ts` e `execution-store.ts`, tabelle prefissate `execution_`. Mappare una tabella per le entità sopra e tabelle join per riferimenti multivalore; indici unici su ID, (parentId,revision) e chiavi di idempotenza. Una revisione non cambia contenuto dopo seal. Update di stato usa CAS expectedStateRevision, incrementa revisione ed emette outbox nella stessa transazione.

Non creare un secondo ledger: `workflow_operations`/grant/artefatti comuni sono introdotti005. Le operazioni di questo modulo usano il namespace canonico specificato nel contratto API, requestId e hash dell’intent. UUID globali devono essere esclusivi anche nei ledger preesistenti. Riferimenti a oggetti solo dopo seal/fsync/hash; reservation conteggiata finché reconcile o discard sicuro dimostrano la liberazione.

## State Transitions

Session CREATED → RUNNING → WAITING_USER/PAUSED/READY_FOR_REVIEW/FAILED/INTERRUPTED/RECONCILING. Run PREPARED → HOST_READY → START_AUTHORIZED → RUNNING → terminale solo con exitProof; provider done non è review PASS. Resume da checkpoint crea nuova generation, non ripete vecchio run.

Stato operazione e stato dell’entità sono distinti: admission riuscita non implica workflow concluso. Un processo/evento di generation superata non modifica l’entità corrente. Esito remoto o uscita processo non provati restano UNKNOWN/RECONCILING con debit/lease, non terminali di successo.

## Invarianti e autorizzazioni

- Revisioni/config/digest nell’intent devono coincidere con snapshot approvato e stato corrente prima dell’effetto. La verifica filesystem richiede observation e controllo finale, non una transazione globale immaginaria.
- Agente scrive solo i file del workspace autorizzato; `.git`, refs/config/hooks e checkout originali non scrivibili. Commit/check di repository sono azioni core con manifest/versione.
- Codex pin004 è un input da riqualificare per write/exec, non un via libera; Claude pin/supporto login da qualificare senza API key implicita. Capabilities per binario/hash/version/auth/policy, nativeResume solo se provato.
- Relazioni con entità storiche conservate; rimozione solo senza riferimenti e senza lavoro/processi/effetti incerti.
- 1run attivo per daemon prima010; un writer/workspace; run≤30min, input≤2MiB e≤512KiB profilo, output quote comuni;20interazioni/run,4KiB/testo; shutdown entro budget Foundation esistente.
- Quota e riserva terminale come [contratti trasversali](../../docs/missing-features-contracts.md); query/cancel/recovery disponibili a saturazione, niente eviction automatica di dati irrisolti.

## Recovery e schema

Testare fault prima/dopo commit di upgrade e ogni pubblicazione artefatto/effetto delle storie. Reader storico immutabile; offline freshness LAST_KNOWN e eligibility=false/UNKNOWN. Riconciliare identità archive, FK, riferimenti/hash e prove esterne prima di rilasciare risorse. Se prova assente o ambigua, preservare i dati e rendere il blocco interrogabile con requestId originale.
