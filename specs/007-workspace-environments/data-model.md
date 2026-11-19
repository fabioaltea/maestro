# Data Model — Workspace Environments & Dependencies

**Schema proposto**: 7 cumulativo dopo6; nessuna tabella implementata da questa pianificazione. Identità UUID, revisioni decimali stringa, timestamp UTC e digest SHA256 come nella base.

## Entità e relazioni

| Entità | Campi, relazioni e validazione |
|---|---|
| EnvironmentPlan | planId,workspaceId,workspaceGeneration,manifestDigest,lockDigest,configDigest,managerId,binaryHash/version,scriptPolicy,networkScope,budget,digest |
| EnvironmentInstance | environmentId,planId,state,stateRevision,preparedDigest,storeRef,virtualStoreRef,manualAttestationId; READY vale solo per input correnti |
| EnvironmentJob | jobId,type INSTALL/VALIDATE,commandSpecId,planDigest,leaseId,hostIdentity,generation,outcome,outputWatermark |
| EnvironmentAttestation | attestationId,workspaceId,inputDigest,kind MANUAL/QUALIFIED,limitations,ownerUid,createdAt; mai simulare install riuscita |

Tutte le righe hanno storeId e riferimenti projectId/featureId applicabili; FK impediscono riferimenti ad altri store o revisioni di altra entità. Configurazioni e approvazioni sono append-only; disabilitazione/tombstone non cancella dati referenziati. Per le associazioni esterne usare ID opachi e digest, mai token o path del client come autorità.

## Tabelle e commit

Persistenza in `src/storage/environments-schema.ts` e `environments-store.ts`, tabelle prefissate `environments_`. Mappare una tabella per le entità sopra e tabelle join per riferimenti multivalore; indici unici su ID, (parentId,revision) e chiavi di idempotenza. Una revisione non cambia contenuto dopo seal. Update di stato usa CAS expectedStateRevision, incrementa revisione ed emette outbox nella stessa transazione.

Non creare un secondo ledger: `workflow_operations`/grant/artefatti comuni sono introdotti005. Le operazioni di questo modulo usano il namespace canonico specificato nel contratto API, requestId e hash dell’intent. UUID globali devono essere esclusivi anche nei ledger preesistenti. Riferimenti a oggetti solo dopo seal/fsync/hash; reservation conteggiata finché reconcile o discard sicuro dimostrano la liberazione.

## State Transitions

UNCONFIGURED → PLANNED → PREPARING → READY; input cambiati → STALE; manager unsupported → MANUAL_REQUIRED. Job QUEUED/RUNNING → SUCCEEDED/FAILED/CANCELLED/RECONCILING; nessun READY se uscita o integrità ignote.

Stato operazione e stato dell’entità sono distinti: admission riuscita non implica workflow concluso. Un processo/evento di generation superata non modifica l’entità corrente. Esito remoto o uscita processo non provati restano UNKNOWN/RECONCILING con debit/lease, non terminali di successo.

## Invarianti e autorizzazioni

- Revisioni/config/digest nell’intent devono coincidere con snapshot approvato e stato corrente prima dell’effetto. La verifica filesystem richiede observation e controllo finale, non una transazione globale immaginaria.
- Preparazione scrive solo workspace posseduto e store dedicato; lockfile e manifest restano invariati in modalità frozen; niente Git mutations.
- Nessun provider; script/installazioni sono esecuzione di codice con autorizzazione distinta dal piano feature.
- Relazioni con entità storiche conservate; rimozione solo senza riferimenti e senza lavoro/processi/effetti incerti.
- Install/validate max5min ciascuno; input config totale1MiB/200file; budget10GiB/workspace20GiBtotale, free<2GiB blocca; max2job solo quando010 disponibile, prima1.
- Quota e riserva terminale come [contratti trasversali](../../docs/missing-features-contracts.md); query/cancel/recovery disponibili a saturazione, niente eviction automatica di dati irrisolti.

## Recovery e schema

Testare fault prima/dopo commit di upgrade e ogni pubblicazione artefatto/effetto delle storie. Reader storico immutabile; offline freshness LAST_KNOWN e eligibility=false/UNKNOWN. Riconciliare identità archive, FK, riferimenti/hash e prove esterne prima di rilasciare risorse. Se prova assente o ambigua, preservare i dati e rendere il blocco interrogabile con requestId originale.
