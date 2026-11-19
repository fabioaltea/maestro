# Data Model — Feature Planning & Versioned Approval

**Schema proposto**: 5 cumulativo dopo4; nessuna tabella implementata da questa pianificazione. Identità UUID, revisioni decimali stringa, timestamp UTC e digest SHA256 come nella base.

## Entità e relazioni

| Entità | Campi, relazioni e validazione |
|---|---|
| Feature | featureId,projectId,title≤120caratteri,state,stateRevision,currentRevisionId,archivedAt; max1000/archivio |
| FeatureRevision | revisionId,featureId,parentRevisionId,requestArtifactId,specArtifactId,planArtifactId,acceptanceCriteria,digest,discoveryApprovalId,contextDigest; immutabile,≤50revisioni |
| FeatureApproval | approvalId,revisionId,bundleDigest,discoveryApprovalId,contextDigest,ownerUid,approvedAt; storico append-only |
| PlanningTurn | turnId,featureId,runId,generation,questionIds,answerRevision,inputDigest,resultArtifactId,outcome; max20turni/20domande |
| ImplementationEnvelope | envelopeId,featureId,revisionId,approvalId,projectConfigRevision,contextDigest,digest; non è ancora un grant start009 |

Tutte le righe hanno storeId e riferimenti projectId/featureId applicabili; FK impediscono riferimenti ad altri store o revisioni di altra entità. Configurazioni e approvazioni sono append-only; disabilitazione/tombstone non cancella dati referenziati. Per le associazioni esterne usare ID opachi e digest, mai token o path del client come autorità.

## Tabelle e commit

Persistenza in `src/storage/features-schema.ts` e `features-store.ts`, tabelle prefissate `features_`. Mappare una tabella per le entità sopra e tabelle join per riferimenti multivalore; indici unici su ID, (parentId,revision) e chiavi di idempotenza. Una revisione non cambia contenuto dopo seal. Update di stato usa CAS expectedStateRevision, incrementa revisione ed emette outbox nella stessa transazione.

Non creare un secondo ledger: `workflow_operations`/grant/artefatti comuni sono introdotti005. Le operazioni di questo modulo usano il namespace canonico specificato nel contratto API, requestId e hash dell’intent. UUID globali devono essere esclusivi anche nei ledger preesistenti. Riferimenti a oggetti solo dopo seal/fsync/hash; reservation conteggiata finché reconcile o discard sicuro dimostrano la liberazione.

## State Transitions

DRAFT → PLANNING → WAITING_USER → DRAFT/READY_FOR_APPROVAL → APPROVED; revisione successiva o freshness non corrente → NEEDS_REVIEW; archive solo senza risorse/sessioni attive. PLANNING interrotto → INTERRUPTED/RECONCILING, nessun nuovo turno implicito.

Stato operazione e stato dell’entità sono distinti: admission riuscita non implica workflow concluso. Un processo/evento di generation superata non modifica l’entità corrente. Esito remoto o uscita processo non provati restano UNKNOWN/RECONCILING con debit/lease, non terminali di successo.

## Invarianti e autorizzazioni

- Revisioni/config/digest nell’intent devono coincidere con snapshot approvato e stato corrente prima dell’effetto. La verifica filesystem richiede observation e controllo finale, non una transazione globale immaginaria.
- Repository e Git in sola lettura; verificare il contesto Discovery corrente prima di creazione, approvazione e rilascio dell’handoff.
- Manuale sempre senza inferenza; generazione disabilitata se provider non qualificato. Nessun nuovo SDK, API key o fallback per aggirare004.
- Relazioni con entità storiche conservate; rimozione solo senza riferimenti e senza lavoro/processi/effetti incerti.
- Richiesta≤16KiB; bundle≤256KiB;≤50criteri e20domande/turni; generation readonly≤10min, contesto≤30s; quota workflow condivisa.
- Quota e riserva terminale come [contratti trasversali](../../docs/missing-features-contracts.md); query/cancel/recovery disponibili a saturazione, niente eviction automatica di dati irrisolti.

## Recovery e schema

Testare fault prima/dopo commit di upgrade e ogni pubblicazione artefatto/effetto delle storie. Reader storico immutabile; offline freshness LAST_KNOWN e eligibility=false/UNKNOWN. Riconciliare identità archive, FK, riferimenti/hash e prove esterne prima di rilasciare risorse. Se prova assente o ambigua, preservare i dati e rendere il blocco interrogabile con requestId originale.
