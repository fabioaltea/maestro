# E2 — streaming live con backpressure / T072

**Data**: 2026-11-08. **Branch**: `001-core-background-daemon-implementation`.
**Esito**: PASS E2, T068–T072; avanzamento T001–T072 su 87.
Restano E3, accettazione US4 e validazione finale V1.

## Verifiche eseguite

- `npm run typecheck` e `npm run lint`: PASS.
- `npm test`: **115/115 PASS**, zero failure, test saltati o cancellati.
- `node --test dist-tests/tests/acceptance/event-stream.test.js`: **1/1 PASS**.
- Pump: write=false sospende produzione e letture fino a drain; errore di write,
  assenza permanente di drain, limite aggregato e impossibilità di inviare il frame
  finale chiudono la sottoscrizione e rilasciano i listener.
- Contratto: autenticazione, identity/correlation/subscriptionId e schema verificati;
  frame con correlazione, identità o payload errati non raggiungono il consumer.
- La chiusura è autorizzata solo sulla connessione proprietaria. Una capability client
  non acquisisce permessi di controllo del lifecycle attraverso la sottoscrizione.
- Evento presente fisicamente dopo crash prima del completamento del drain: nessuna
  consegna fino al commit di highWater; poi una sola consegna della stessa identità.
- `events --follow --json` emette un frame per riga. SIGINT sul processo fixture della CLI
  chiude il client con exit 0 e lascia lo stesso daemon RUNNING/ready=true.
- Le letture dello stato restano vive mentre una scrittura diagnostica attende un altro
  writer; i test di E1 su tail, checksum, quota, outbox e crash continuano a passare.

## Ambiente e workload finale

Node 26.13.0, macOS 26.3.1 arm64/APFS,
TypeScript 6.0.3, better-sqlite3 13.0.3; package 0.1.0, schema **2 invariato**.
Working tree T072 su base `8264d91`. Campagna separata dalla suite ordinaria.
Misura UTC: `2026-11-08T18:32:29.084Z`.

Due sottoscrizioni UDS reali sullo stesso daemon. Il consumer lento trattiene la prima
callback, facendo propagare la pressione fino al socket server; quello attivo continua
ad accettare gli eventi. Una fixture core produce **8.192 eventi** in batch di 128 tramite
lo storage worker, mentre altre CLI eseguono 30 richieste di stato. Nessun endpoint pubblico
per produrre eventi arbitrari viene introdotto.

| Osservatore | Frame accettati dal socket server | Picco aggregato, byte | Motivo chiusura |
|---|---:|---:|---|
| Attivo | 8192 | 48039 | nessuno |
| Lento, chiuso | 305 | 87092 | SLOW_CONSUMER |

Limite: **1.048.576 byte** per osservatore. Picco massimo campionato: **87,092 byte**.
Il conteggio comprende la pagina applicativa, il frame da trasferire, writableLength
ed eventuali richieste/input ancora posseduti dalla connessione. Il frame già passato
al socket viene contato in writableLength e non duplicato nel buffer del pump.

Il consumer attivo ha ricevuto **8192 eventi**, tutti in ordine contiguo;
ultimo ricevuto **8197**, highWater durevole finale della prova **8197**.
Il consumer lento risulta chiuso con SLOW_CONSUMER e la connessione del consumer attivo
rimane disponibile. Il daemon mantiene instanceId e readiness.

| Stato concorrente | Misurato | Target della prova | Esito |
|---|---:|---:|---|
| Campioni | 30 | tutti conservati | PASS |
| p95 | 215.92 ms | <=500 ms | PASS |
| Massimo | 227.18 ms | <=2.000 ms | PASS |

I tempi includono avvio della CLI compilata e risposta JSON. Sono i campioni di questo
carico a due osservatori; non attestano la campagna SC-002 da dieci client e 1.000 letture.
Campioni individuali e statistiche: [e2-stream-samples.json](e2-stream-samples.json).

## Meccanismo e invarianti

- Il journal durevole è l'unica storia. Un polling condiviso ogni 50 ms segnala soltanto
  cambiamenti di highWater; i wake-up sono coalescenti, senza accumulare una coda di eventi.
- Ogni pump conserva un cursore e una pagina bounded. Letture SQL e file finiscono prima
  dell'attesa di drain; nessuna sottoscrizione mantiene transazioni o descriptor del journal.
- write=false richiede drain, con attesa limitata a un secondo. Un consumer fermo non
  trattiene il worker o le altre connessioni. L'ultimo frame di errore viene inviato solo
  se il canale e il budget lo consentono; altrimenti resta la chiusura del collegamento.
- Le statistiche dei chiusi sono limitate alle ultime dieci; la diagnostica mantiene
  contatori e motivo redatto. Il tentativo di audit persistente SLOW_CONSUMER è best effort
  e non autorizza effetti aggiuntivi sul lifecycle.
- Il cursore server indica frame accettati dal socket, non ricezione applicativa.
  `lastReceived` lato client avanza soltanto dopo la callback completata. Il client non
  usa `lastSent` del server per saltare dati in una futura riconnessione.
- Le nuove letture possono procedere mentre una scrittura SQLite ritenta BUSY. Le chiamate
  native restano sincrone nel worker: ogni transazione termina prima di cedere l'event loop;
  le mutazioni mantengono la loro coda seriale.
- La validazione dei reader si arresta al prefisso highWater confermato. Un tail ancora
  in append non viene interpretato come dato pubblicato o come corruzione dello stato vivo.
  File rimossi durante retention danno una chiusura/gap conservativa, senza mutazioni del reader.

## Esecuzioni intermedie e correzioni

T068/T069 sono stati verificati RED prima del codice. Una prima accettazione sotto carico
ha ricevuto uno stato non-ready e non è conteggiata come PASS. Il payload completo di quel
primo fallimento non era stato acquisito: non si attribuisce una causa univoca non osservata.
Una ripetizione successiva è passata; il gate è stato poi rafforzato con casi deterministici:

1. Separata la progressione delle letture dai retry di una scrittura diagnostica bloccata.
2. Validato soltanto il prefisso confermato mentre un writer modifica il tail.
3. Tollerata la scomparsa di un nome durante il campionamento delle allocazioni in rotazione;
   identità, tipo e permessi dei file ancora presenti continuano a essere verificati.
4. Esteso il budget ai byte delle richieste ancora in coda e dell'input della connessione.
5. Verificati esplicitamente frame con identity/correlation/schema non validi.

La suite finale è 115/115 e l'accettazione finale ha zero anomalie. Tutti i 30 campioni di
stato sono inclusi nel percentile; nessuna soglia è stata modificata.

## Uso e limiti

```sh
npm run build
node dist/cli/main.js daemon events --follow --state-dir "$review_dir" --json
```

`review_dir` è un percorso assoluto di uno store schema 2 e il daemon deve essere già avviato.
Il follow non inizializza un archivio assente e non avvia automaticamente il servizio.
SIGINT/SIGTERM o la chiusura della pipe della CLI scollegano soltanto il client.
La deadline di --timeout-ms riguarda l'apertura, non la durata dello streaming.

E2 parte dal highWater catturato alla sottoscrizione. Replay con --after, cursore opaco,
WRONG_STORE, riallineamento dopo CURSOR_EXPIRED e passaggio replay/live appartengono a E3;
i parametri non supportati sono rifiutati. Nessuna promessa exactly-once o riconnessione
con perdita silenziosa viene introdotta.

SC-002/SC-007 completi, dieci osservatori a 100 eventi/s per 60 s, idle/RSS/CPU per dieci
minuti e runner con UID distinti rimangono NOT_RUN come campagne complete. I report E1/F2
conservano le proprie evidenze storiche. Nessun provider, Agent Runtime, worktree, gestione
dipendenze di progetti, pnpm o Electron è incluso. Nessun push o merge eseguito.

Checkpoint E2 pronto per review. E3 non avviato. Hook Git facoltativi gestiti mediante i
commit per task già autorizzati, senza commit aggregato aggiuntivo.
