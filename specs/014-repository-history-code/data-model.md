# Data Model: consultazione repository

| Entità | Campi principali | Regole |
| --- | --- | --- |
| `ReadContext` | `projectId`, `configRevision`, identità repository, `generation` | Limitato al progetto attivo e alla finestra. Invalidato al cambio progetto o alla chiusura; il refresh sostituisce la generazione solo a lettura riuscita. |
| `HistorySnapshot` | radici OID, riferimenti, worktree, cursore | Solo stato in memoria. Pagine ordinate deterministicamente sugli stessi OID; refresh esplicito per riacquisire i riferimenti. |
| `CommitSummary` / `CommitDetail` | OID completo, genitori, autore, data, titolo, messaggio e pagina di percorsi modificati | Per un merge, confronto con il primo genitore dichiarato; per una radice, confronto con l'albero vuoto. Riepilogo e dettaglio si riferiscono allo stesso commit. |
| `RepositoryRef` | nome completo, tipo, OID, commit di destinazione se applicabile | Solo branch locali, tag e riferimenti remoti presenti in locale. |
| `ObservedWorktree` | percorso, branch o detached, OID, stato di osservazione | Distinguere bloccato e non verificabile. Indicare «stato non verificato» quando l'inventario non basta; non riportare clean/dirty. |
| `MainSnapshot` | OID del commit di `refs/heads/main`, handle di vista | L'OID non cambia durante la lettura. Refresh riuscito chiude o ricarica insieme schede e albero; refresh fallito mantiene lo snapshot esplicitamente precedente. |
| `TreeEntry` / `BlobPage` | percorso Git, nome, tipo, dimensione se nota; byte decodificabili, offset per blob | Niente path di filesystem comunicate dal client; risoluzione letterale dallo snapshot, nessuna dereferenziazione di symlink o gitlink. |

Stati UI: `loading` → `ready`, `empty` o `unavailable`; retry sulla stessa osservazione se ancora valida, altrimenti nuova apertura. Un file non visualizzabile non invalida l'albero né le altre schede.
