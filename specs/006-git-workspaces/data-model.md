# Data Model — Owned Git Workspaces

**Schema proposto**: 6 cumulativo dopo5; nessuna tabella implementata da questa pianificazione. Identità UUID, revisioni decimali stringa, timestamp UTC e digest SHA256 come nella base.

## Entità e relazioni

| Entità | Campi, relazioni e validazione |
|---|---|
| Workspace | workspaceId,featureId,repositoryKey,baseRef,baseOid,branchRef,pathKey,anchor,state,stateRevision,ownerGeneration; massimo20/archivio |
| WorkspaceOwnership | workspaceId,storeId,repositoryAnchor,gitCommonAnchor,worktreeGitAnchor,markerDigest,createdByRequestId; marker privato non basta senza prove Git/fs |
| WorkspaceLease | workspaceId,holderType,holderId,generation,releaseProof; un writer, nessuna scadenza sufficiente da sola a liberarlo |
| WorkspaceEffect | requestId,branchExpectedAbsent,pathExpectedAbsent,baseOid,observedBranchOid,phase,exitProof; legato al ledger workflow |

Tutte le righe hanno storeId e riferimenti projectId/featureId applicabili; FK impediscono riferimenti ad altri store o revisioni di altra entità. Configurazioni e approvazioni sono append-only; disabilitazione/tombstone non cancella dati referenziati. Per le associazioni esterne usare ID opachi e digest, mai token o path del client come autorità.

## Tabelle e commit

Persistenza in `src/storage/workspaces-schema.ts` e `workspaces-store.ts`, tabelle prefissate `workspaces_`. Mappare una tabella per le entità sopra e tabelle join per riferimenti multivalore; indici unici su ID, (parentId,revision) e chiavi di idempotenza. Una revisione non cambia contenuto dopo seal. Update di stato usa CAS expectedStateRevision, incrementa revisione ed emette outbox nella stessa transazione.

Non creare un secondo ledger: `workflow_operations`/grant/artefatti comuni sono introdotti005. Le operazioni di questo modulo usano il namespace canonico specificato nel contratto API, requestId e hash dell’intent. UUID globali devono essere esclusivi anche nei ledger preesistenti. Riferimenti a oggetti solo dopo seal/fsync/hash; reservation conteggiata finché reconcile o discard sicuro dimostrano la liberazione.

## State Transitions

REQUESTED → CREATING → READY; READY → IN_USE → READY con prova di rilascio; identità/path mutati → BLOCKED. Effetto interrotto → RECONCILING → READY/BLOCKED; READY → REMOVING → REMOVED solo con prova di integrazione e assenza di lavoro/processi.

Stato operazione e stato dell’entità sono distinti: admission riuscita non implica workflow concluso. Un processo/evento di generation superata non modifica l’entità corrente. Esito remoto o uscita processo non provati restano UNKNOWN/RECONCILING con debit/lease, non terminali di successo.

## Invarianti e autorizzazioni

- Revisioni/config/digest nell’intent devono coincidere con snapshot approvato e stato corrente prima dell’effetto. La verifica filesystem richiede observation e controllo finale, non una transazione globale immaginaria.
- Lease per repositoryKey + controllo worktree/branch/anchor prima e dopo ogni effetto; niente --force, prune globale, reset o adozione implicita.
- Nessun provider chiamato; workspace non è confine di sicurezza e non abilita l’esecuzione009.
- Relazioni con entità storiche conservate; rimozione solo senza riferimenti e senza lavoro/processi/effetti incerti.
- Max20worktree; provision/remove≤30s con timeout riconciliabile; output Git bounded; un mutatore per repositoryKey; path solo generati dal core.
- Quota e riserva terminale come [contratti trasversali](../../docs/missing-features-contracts.md); query/cancel/recovery disponibili a saturazione, niente eviction automatica di dati irrisolti.

## Recovery e schema

Testare fault prima/dopo commit di upgrade e ogni pubblicazione artefatto/effetto delle storie. Reader storico immutabile; offline freshness LAST_KNOWN e eligibility=false/UNKNOWN. Riconciliare identità archive, FK, riferimenti/hash e prove esterne prima di rilasciare risorse. Se prova assente o ambigua, preservare i dati e rendere il blocco interrogabile con requestId originale.
