# Contract — Electron bridge v1

Contratto esclusivamente app-local main↔preload↔renderer; non modifica IPC/core v1. Implementazione futura in `apps/desktop/src/shared/bridge-contract.ts` e `src/preload/index.cts`. Tutte le strutture sono plain JSON con chiavi chiuse, validazione runtime e limiti del piano.

## Envelope e superficie

Richiesta: `{bridgeVersion:1, callId:UUID, selectionEpoch:number, ...paramsSpecifici}`. Risposta: `{bridgeVersion:1, callId, selectionEpoch, archiveHandle, storeId, result}`; risultato core è PublicResult validato e proiettato, errore bridge è codice chiuso con messaggio/azione sicuri, mai eccezione Electron/stack/stderr. Nessun canale o percorso eseguibile dal chiamante. Epoch mismatch respinto senza effetti. La selezione iniziale usa epoch0 e handle null.

API esposta `window.maestro`:

| Metodo | Input aggiuntivo | Esito / limite |
|--------|------------------|----------------|
| chooseArchive | newArchiveName?:nome singolo validato | dialog cartella; annullamento esplicito; nuovo contesto opaco, nessuna creazione |
| context | nessuno | archivio attivo/stato bootstrap/runtime sicuro |
| status / diagnostics | nessuno | lettura corrente o LAST_KNOWN core |
| listProjects | cursor?:opaque, limit?:25 | pagina validata, invalidazione REGISTRY_CHANGED |
| getProject | projectId:UUID | dettaglio/tombstone sicuri |
| chooseRepository | nessuno | picker con handle opaco main-bound all'epoch, displayPath solo per riepilogo |
| prepareAction | action chiusa, params specifici | riepilogo immutabile+confirmationId+scadenza; nessun effetto |
| confirmAction | confirmationId:UUID | consume once → ricevuta durevole → singolo invio; UUID operativo restituito |
| cancelAction | confirmationId | invalidazione, nessun invio |
| reconcileOperation | receiptId:UUID | query su archivio/namespace originali, mai re-execute |
| listReceipts | nessuno | lista limitata per archivio e indicatori altri archivi; senza percorsi/intent secret |
| selectReceiptArchive | receiptId:UUID | selezione del percorso privato originale dopo conferma nativa; nessun effetto core |
| dismissReceipt | receiptId:UUID | solo terminale riconciliata; unresolved sempre respinta |
| readEvents | after?:opaque, limit?:1..100 | storia core, proiezione limitata |
| startEvents | afterApplied?:opaque | un stream scoped, nessun retry automatico |
| stopEvents | subscriptionId:UUID | chiusura solo client posseduto |
| ackEvents | subscriptionId,batchId,lastAppliedSeq | avanzamento cursor soltanto se batch integro e scoped |
| onActivity | callback locale | restituisce unsubscribe; nessun oggetto ipcRenderer/Event Electron |

`prepareAction.action`: daemon.start/stop/restart, project.register/verify/update/remove. Parametri:
- start/stop/restart nessun argv arbitrario; archivio dal contesto main.
- register: repositoryHandle, name? e baseBranch?; handle proviene dal picker di questa epoch. Il path reale non può essere sostituito dal renderer.
- verify: projectId; l'azione esplicita vale come conferma del riepilogo, senza dialog distruttivo aggiuntivo.
- update: projectId, expectedRevision e patch non vuota `{name?,baseBranch?:string|null}`; omissione≠null.
- remove: projectId, expectedRevision; riepilogo chiarisce rimozione della sola registrazione.

Prepare→confirm è l'unico accesso mutativo, incluso Avvia. Per import/verifica è sufficiente il pulsante intenzionale sul riepilogo della vista; stop/restart/update/remove hanno dialog di conferma. Main ricalcola hash, non accetta riepiloghi/UUID di operazione arbitrari. Core autentica e applica CAS/idempotenza: UI token non sostituisce questi controlli.

## Sicurezza

Main accetta solo webContents della finestra proprietaria, top frame vivo e origine esatta `maestro://app`; iframe, subframe, sender esterno, extra keys, versione ignota, handle obsoleto e schema non conforme sono respinti prima di file/spawn. Richieste≤32KiB,≤8 pending read. Nessun metodo per fs, SQL, exec, shell, token, fetch, openExternal, scegli-binario o generic invoke. Main stesso non carica codice dei repository né interpreta testo come HTML.

Errori bridge chiusi: INVALID_INPUT, STALE_CONTEXT, CONFIRMATION_EXPIRED, CONFIRMATION_REQUIRED, LOCAL_BUSY, RUNTIME_UNAVAILABLE, BUILD_UNAVAILABLE, CLIENT_PROTOCOL_ERROR, CLIENT_OUTPUT_LIMIT, RECEIPT_STORAGE_UNAVAILABLE, RECEIPT_LIMIT, OPERATION_UNCERTAIN, STREAM_SATURATED, STREAM_GAP. I codici core rimangono invariati e distinguibili. Dopo possibile invio, errori client diventano PublicResult UNKNOWN_OUTCOME con UUID receipt, non un errore validazione che suggerisce retry sicuro.

## Eventi bridge

`activity.batch`: subscriptionId, batchId, epoch, storeId, eventi validati≤32/64KiB e cursore finale candidato. Renderer applica in ordine, poi ACK. Main fa avanzare il proprio checkpoint dopo ACK, mai su ricezione stdout. Un solo batch pendente. `activity.state`: HISTORY/CONNECTING/LIVE/DISCONNECTED/GAP/SATURATED, codice sicuro, ultimo cursore applicato, eventuali firstAvailable/highWater core.

ACK duplicato dell'ultimo batch è idempotente; batch fuori ordine/owner/epoch/store errato non avanza. Errore decoder, salto seq, timeout ACK o overflow: chiusura client, stato esplicito, nessuna perdita silenziosa o reconnect automatico. Chiusura pannello/archivio/finestra rimuove listener e stream della relativa generazione.
