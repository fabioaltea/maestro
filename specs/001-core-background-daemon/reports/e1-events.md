# E1 — eventi persistenti e diagnostica / T067

**Data**: 2026-11-08. **Branch**: `001-core-background-daemon-implementation`.
**Esito**: PASS E1, task T059–T067. Avanzamento T001–T067 su 87.
US4 conserva E2, E3 e accettazione finale; la feature 001 non è ancora completa.

## Verifiche finali

- `npm run typecheck` e `npm run lint`: PASS.
- `npm test`: **106/106 PASS**, nessun test saltato, cancellato o fallito.
- `node --test dist-tests/tests/acceptance/event-persistence.test.js`: **2/2 PASS**.
- Cinque crash reali con exit 86 prima/dopo commit, append, sync e clear:
  stato non committato assente; stato committato preservato; eventi non pubblicati
  prematuramente; seq/eventId stabili e nessuna duplicazione dopo drain ripetuto.
- Tail parziale riparata soltanto se coincide con il frame del batch pendente.
  Checksum discordante preservato e segnalato STATE_CORRUPT, senza cancellazione o reset.
- WAL con reader esterno che impedisce checkpoint: nuove scritture bloccate,
  WAL entro 2 MiB, outbox entro 64 KiB e storico autorevole preservato.
- Letture offline, consultazione paginata, correlazione IPC, permessi, output umano/JSON
  e sentinelle: PASS. Revisione applicativa invariata dopo letture e tentativi negati.
- Errori arbitrari, ambiente, capability e percorsi delle credenziali non entrano nei
  payload o nei log. Le decisioni negate usano codice/correlationId e conteggio bounded.

## Ambiente e campagna

Node 26.13.0, macOS 26.3.1 arm64/APFS,
TypeScript 6.0.3, better-sqlite3 13.0.3; package 0.1.0, schema **2**.
Campagna misurata nel working tree T067 su base `0f143a9`, separata dalla suite ordinaria.
Misura UTC: `2026-11-08T17:54:48.136Z`.

La fixture semina 1.000 operazioni terminali in bootstrap e ne verifica nuovamente ogni
esito dopo la saturazione. Genera 3.500 record prossimi al massimo del codec, per
**50,048,893 byte** prima della retention, e poi 2.048 eventi
attraverso la redazione/outbox del core: **5,548 eventi totali**.
I record grandi sono fixture del codec, non payload applicativi non redatti della CLI.
Tutti i 1.000 esiti rimangono SUCCEEDED; non viene eseguito pruning dello stato autorevole.

I byte sono allocazioni fisiche `st_blocks * 512`, includendo directory, file journal/log,
intero WAL e SHM. `dbstat` conta le pagine diagnostiche; viene aggiunta conservativamente
l'intera freelist condivisa. I massimi per categoria possono avvenire in istanti diversi;
il massimo totale è campionato simultaneamente.

| Categoria | Picco campionato, byte | Target massimo, byte | Esito |
|---|---:|---:|---|
| Journal e metadata di retention linkati | 41.881.600 | 41.943.040 | PASS |
| Log strutturati | 5.156.864 | 5.242.880 | PASS |
| Intero WAL condiviso | 1.052.672 | 2.097.152 | PASS |
| Pagine outbox/metadata + intera freelist | 45.056 | 1.048.576 | PASS |
| Totale linkato simultaneo | 47.779.840 | 52.428.800 | PASS |
| Payload outbox | 38.657 | 65.536 | PASS |

SHM interamente conteggiata: **32,768 byte**.
Totale di regime linkato: **45.566 MiB**, target 50 MiB.

## Retention, reader e spazio temporaneo

La retention elimina i segmenti più vecchi, preservando quelli necessari all'outbox.
Il floor viene sincronizzato in un descriptor privato prima dell'unlink, quindi riportato
nei metadata SQLite al drain. Una coda temporanea `retention.next` non modifica la lettura
read-only né il floor pubblicato. Non si copiano intere storie durante la rotazione.

Questa implementazione usa segmenti di **64 KiB**, sotto il massimo di 1 MiB del piano:
anche la lettura completa di un segmento è bounded a 64 KiB. Ogni pagina è materializzata
prima di tornare al client e i file vengono chiusi prima dell'attesa sul socket.
Con dieci lettori in volo, la quota massima di segmenti eventualmente non più linkati
è quindi 640 KiB, all'interno del margine temporaneo previsto.

La fixture forza questo caso mantenendo **10 descriptor** aperti mentre la
retention rimuove i rispettivi nomi. Somma `fstat(fd).blocks * 512` soltanto quando nlink=0,
senza contare due volte i file ancora linkati. Il picco di questi file è
**573,440 byte**; i descriptor artificiali vengono chiusi nel teardown.
L'API pubblica non restituisce descriptor da trattenere.

Il picco totale effettivo, inclusi questi file non linkati e le allocazioni intermedie
campionate prima del pruning, è **48,398,336 byte
(46.156 MiB)**, entro il tetto temporaneo assoluto di 55 MiB
(50 MiB più 5 MiB). Il test verifica anche che un eccesso temporaneo sia ammesso soltanto
per riconciliare un batch già presente: non autorizza una nuova mutazione a quota aumentata.

La retention è osservata: floor iniziale dopo saturazione **581**,
finale **629**; highWater finale **5548**,
outbox finale **0 byte**, diagnostica non degradata. La pagina CLI massima della prova
è **57,990 byte**, entro 65.536; truncated è esplicito.

Campioni e configurazione: [e1-events-samples.json](e1-events-samples.json).

## Correzioni ed esecuzioni intermedie

- T059–T061 sono test RED verificati prima dei relativi contratti.
- La prima verifica di consultazione mostrava lifecycle senza operationId; ora la
  serializzazione aggiunge la richiesta pendente quando applicabile.
- Una prima saturazione con segmenti più grandi si è bloccata con EVENT_BACKPRESSURE:
  **non è conteggiata come PASS**. Non era stato acquisito il dettaglio completo dei byte
  al punto di blocco; non viene attribuita una causa fisica più precisa non osservata.
- Il gate ha aggiunto diagnostica al fallimento, controllo delle allocazioni reali dopo
  il batch e pruning dei log anche in base alle estensioni fisiche, oltre alle stime iniziali.
- Eliminata la scansione completa ripetuta dopo ogni append proprio già validato/sincronizzato;
  modifiche provenienti da altri writer invalidano la cache, mentre le pagine lette verificano i checksum.
- Scritture corte completate con un ciclo; zero avanzamento produce errore senza highWater
  confermato. La highWater del journal viene controllata prima del clear dell'outbox.
- Le ripetizioni intermedie passate appartengono allo sviluppo del gate. Le misure sopra
  sono quelle dell'ultima campagna, con segmenti da 64 KiB e dieci reader intenzionalmente pinned.
  Nessuna soglia è stata aumentata e nessun fallimento è stato rimosso da un percentile.

## Comandi disponibili e compatibilità dello stato

```sh
npm run build
node dist/cli/main.js daemon diagnostics --state-dir "$review_dir" --json
node dist/cli/main.js daemon events --state-dir "$review_dir" --limit 100 --json
```

`review_dir` deve essere un percorso assoluto. Per provare E1 usare un archivio nuovo:
lo schema 2 aggiunge outbox e journal metadata. Gli archivi schema 1 dei checkpoint
precedenti vengono rifiutati con STATE_INCOMPATIBLE, preservando i file; non vengono
migrati, cancellati o ricreati automaticamente. Nessun archivio utente è stato ripulito.

## Limiti e prossimo incremento

E1 fornisce diagnostica, eventi durevoli e pagine bounded. `--follow`, `--after`, cursore
opaco di replay, subscribe e passaggio replay/live restano nei rispettivi task E2/E3.
Il nextAfter numerico della pagina è metadata interno di consultazione, non un cursore
pubblico di replay completo. La storia US4 non è dichiarata completa.

SC-009 è verificato soltanto nella parte di quota diagnostica/saturazione/redazione qui
misurata. Idle/RSS/CPU, dieci minuti senza client, UID distinti, carico di dieci osservatori
con 100 eventi/s e 1.000 letture concorrenti restano NOT_RUN come campagne complete.
Le misure precedenti di controllo/recovery restano nei report F2; non vengono rietichettate
come benchmark nuovi della versione E1.

Nessun provider, Agent Runtime, worktree, gestione dipendenze di progetti, pnpm o Electron.
Nessuna modifica alla Constitution. Hook Git facoltativi soddisfatti mediante i commit per
task autorizzati; nessun commit aggregato extra, push o merge. E2 non è stato avviato.
