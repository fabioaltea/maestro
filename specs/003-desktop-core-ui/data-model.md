# Data Model — Desktop Core UI

Nessuna modifica al dominio/schema3 del core. I DTO di progetto, operazione, PublicResult ed EventRecord restano quelli di001/002. Il desktop conserva soltanto stato di presentazione e ricevute non autorevoli.

## ArchiveContext

- `selectionEpoch`: intero incrementale main, mai fornito come autorità dal renderer.
- `archiveHandle`: UUID opaco, risolto main → percorso assoluto scelto da dialog nativo; il renderer non può assegnare percorsi di esecuzione.
- `storeId`: UUID verificato oppure null prima inizializzazione/lettura; `instanceId` opzionale per liveness.
- `availability`: LOADING | LIVE | LAST_KNOWN | UNAVAILABLE | INCOMPATIBLE.
- `liveness`: LIVE_VERIFIED | ABSENT_VERIFIED | UNKNOWN, copiato dal core, non derivato da freshness.
- `displayPath`: solo percorso dell'archivio scelto, per conferme; mai credenziali/endpoint/key.

Se cambia storeId allo stesso percorso: nuova epoch, conferme invalidate, ricevute precedenti non riassegnate. Risposte epoch/store diverse sono ignorate. Archivio assente rimane assente finché Avvia esplicito non lo inizializza tramite core.

## ProjectView

Proiezione `projectId`, `displayName`, `referenceCheckout`, `baseBranch`, `baseState`, `configRevision`, date e `observation` con observedConfigRevision/completedAt/freshness/flag nullable/error sicuro. Revisioni e sequenze rimangono stringhe decimali, nessuna conversione lossy a Number. Una observation LAST_KNOWN non diventa LIVE perché il registro è LIVE. Base non configurata, invalidata e repository unborn non sono sinonimi di errore UI.

`ProjectListState`: epoch/storeId, pagina corrente (25), cache limitata100 record, cursore opaco e revisione; loading/empty/ready/error. REGISTRY_CHANGED elimina la concatenazione precedente e riparte dalla prima pagina, con avviso. Progetto rimosso mostra tombstone sicura e invalida selezione; reimport = nuovo UUID.

## Confirmation

In memoria main: `confirmationId`, owner webContents/topFrame, epoch, archiveHandle/storeId (oppure precondizione archivio assente per start), action, target, expectedRevision, intentHash, createdAt/expiresAt, consumed. TTL60s. Una conferma non è un permesso core. Inviare allo stesso token un contenuto diverso, riusarlo o cambiare archivio/finestra/revisione fallisce prima dello spawn. Modifiche di input generano nuova prepare. Cancel/scadenza non creano ricevute né processi.

## OperationReceipt

Persistita main in `app.getPath('userData')/operation-receipts/<requestId>.json`, nessun uso SQLite core.

| Campo | Regola |
|-------|--------|
| receiptVersion |1, versione privata desktop |
| requestId | UUID main generato una sola volta prima della ricevuta/spawn |
| namespace/action | foundation: start/stop/restart; project: register/verify/update/remove, allowlist chiusa |
| archivePath/storeId | percorso canonico approvato, identità se disponibile; null store soltanto start su archivio assente |
| projectId/expectedRevision | solo dove applicabili, UUID/stringa di revisione validate |
| intentHash | hash del DTO canonico approvato, nessun contenuto replayabile |
| createdAt/updatedAt | timestamp UTC |
| phase | PREPARED | RECONCILING | TERMINAL | UNKNOWN |
| outcome/errorCode | solo esito core verificato/codice sicuro; null in assenza di prova |

Non conserva nomi, path repository, patch, argomenti comando, credenziali o raw error; archivePath è metadato privato necessario a ritrovare lo store dopo crash, non viene loggato. Max4KiB/file e100file. Creazione esclusiva, path UUID, cartella0700 e file0600, no symlink; scrittura atomica e fsync file/directory prima dell'invio. Fallimento ricezione/persistenza = nessun invio. File corrotti/quarantena occupano capacità e producono blocco esplicito della relativa operatività; mai cancellazione silenziosa. Solo ricevute terminali riconciliate possono essere eliminate dall'utente.

Transizioni:

```text
conferma valida → PREPARED durevole → spawn una volta
PREPARED → RECONCILING (core IN_PROGRESS)
PREPARED/RECONCILING → TERMINAL (esito verificato)
PREPARED/RECONCILING → UNKNOWN (crash, timeout, protocollo incompleto)
UNKNOWN → RECONCILING/TERMINAL (query stessa operazione)
```

Al riavvio tutte le non terminali devono essere interrogate, mai eseguite. L'ID assente non autorizza un nuovo invio: può esserci un controller ancora in admission. Namespace foundation usa `daemon operation`; project usa `project operation`. Risultato su store differente è rifiutato. Per start iniziale con store null, associare il primo store soltanto dopo query positiva dello stesso requestId/azione sul percorso approvato; finché non comprovabile restare UNKNOWN. Il blocco è per archivio/controlli, target progetto o importazioni, come plan.

## ActivityState

`epoch/storeId`, connection (IDLE | HISTORY | CONNECTING | LIVE | DISCONNECTED | GAP | SATURATED), eventi FIFO≤500/4MiB, `lastAppliedCursor`, `pendingBatchId`, `lastAppliedSeq` stringa/BigInt locale senza serializzazione Number.

Il cursore è opaco al renderer per invocazioni; main verifica store e sequenza usando decoder/validatori puri. Una pagina eventi avanza soltanto fino all'ultimo evento applicato. Senza eventi il baseline/highWater deve provenire da una risposta core verificata: non inventare una seq. Tutte le pagine intermedie vengono applicate prima di LIVE, oppure si esplicita una finestra iniziale limitata ottenuta tramite contratto core; non saltare al highWater arbitrariamente. Retention ring UI non cambia la continuità core; mostra “eventi precedenti non mantenuti nella vista”. CURSOR_EXPIRED interrompe e richiede conferma di nuova storia/rilettura stato.

Un solo batch≤32/64KiB pendente, ACK owner/epoch/store/batch/lastSeq validato. Dopo riduzione React e aggiornamento vista il renderer conferma; mancato ACK entro2s interrompe il client stream e conserva l'ultimo cursore applicato. CursorCLI/lastReceived non sostituiscono lastApplied. Cursore non persistito: nuova app riparte dalla storia disponibile dichiarando la finestra, non promette continuità fra processi desktop.
