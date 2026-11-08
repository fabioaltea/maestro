# F2 controllo — checkpoint US2 / T045

**Data**: 2026-11-08. **Branch**: `001-core-background-daemon-implementation`.
**Esito**: PASS del controllo US2, T033–T045; T001–T045 completati.
La feature 001 nel suo complesso conserva 42 task aperti.

## Verifiche finali

- `npm test`: **61/61 PASS**, zero failure, test saltati o cancellati.
- `npm run typecheck`: PASS; `npm run lint`: PASS.
- `npm run test:acceptance`: **1/1 PASS**, campagna di 30 cicli ordinari / 90 comandi.
- Campagna aggiuntiva: **30/30 cicli** con un ausiliario cooperativo per restart,
  90 comandi riusciti, zero anomalie nei campioni.
- SIGTERM e SIGINT ricevuti dal daemon seguono un controllo persistente; SIGHUP preserva
  il servizio. Il test segnala soltanto un figlio osservato direttamente da una fixture;
  il runner e i processi individuati tramite PID persistiti non ricevono segnali.
- Durante contesa del control lease il segnale produce BUSY osservabile e il daemon resta vivo.
- Un richiedente termina con exit 86 dopo accettazione: il restart si conclude senza client.
  Una barriera privata dell'ausiliario rende verificabile la finestra in corso.
- Deadline client, esito storico offline, restart da STOPPED, dieci retry concorrenti,
  payload discordante e tentativo di mutazione con capability client: PASS.
- Stop già concluso e retry storico non arrestano un successore; una richiesta incompatibile
  non aggira un controllo BLOCKED. Il retry di BLOCKED rivalida target e risorse.
- Drain cooperativo, non cooperativo e processo estraneo: PASS. Un'incertezza preserva
  processo e risorsa; la risposta espone nextAction e resourceId senza credenziali o percorsi privati.
- Il controller conserva il lease fra stop e start; STOPPED richiede preparazione completata,
  cessazione osservata e risorse rilasciate. Il daemon mantiene il lease fino alla propria morte.

## Ambiente e metodo

macOS 26.3.1, kernel 25.3.0, arm64/APFS;
Apple M3, 8 CPU logiche,
8 GiB RAM; Node 26.13.0,
TypeScript 6.0.3, better-sqlite3 13.0.3. Le campagne sono state eseguite sequenzialmente,
separate dalla suite concorrente, su archivio temporaneo locale dedicato.

La misura dal chiamante include avvio della CLI compilata e risposta JSON. La campagna
ordinaria usa un client, nessun ausiliario e accumula 90 operazioni prima del cleanup.
I percentili usano nearest rank. Tutti i campioni sono conservati, compresi exit code
ed esito; le soglie della specifica restano immutate. I tempi sono in **millisecondi**.

## SC-001 — 30 cicli ordinari

| Comando | n | Target | p50 | p95 | Max | Entro target |
|---|---:|---:|---:|---:|---:|---:|
| start | 30 | 5000 | 377.88 | 401.91 | 451.82 | 30/30 |
| stop | 30 | 10000 | 278.07 | 288.25 | 288.72 | 30/30 |
| restart | 30 | 15000 | 425.91 | 435.19 | 480.19 | 30/30 |

Misura UTC: `2026-11-08T15:49:22.906Z`. **PASS**: 30/30 per ciascuna soglia, contro almeno 95% richiesto.
Campioni: [f2-control-samples.json](f2-control-samples.json).

Per lo stop non completabile, un ausiliario autentica lo shutdown e risponde, ma resta
vivo: osservazione finale **8.290,23 ms**, esito BLOCKED, target <=10.000 ms. Daemon e
risorsa restano presenti, shutdownPrepared=false, nextAction e resourceId disponibili.
Dopo la chiusura esplicita della sola fixture, il retry dello stesso requestId verifica
l'assenza e completa lo stop. Nessuna terminazione forzata.

## Campagna aggiuntiva — un ausiliario per restart

| Comando | n | Target | p50 | p95 | Max | Entro target |
|---|---:|---:|---:|---:|---:|---:|
| start | 30 | 5000 | 376.76 | 429.26 | 448.98 | 30/30 |
| stop | 30 | 10000 | 277.71 | 282.63 | 290.64 | 30/30 |
| restart | 30 | 15000 | 469.55 | 491.89 | 515.80 | 30/30 |

Misura UTC: `2026-11-08T15:45:43.457Z`. Questa campagna conserva il carico ausiliario separato
dal carico ordinario richiesto da SC-001.
Campioni: [f2-control-auxiliary-samples.json](f2-control-auxiliary-samples.json).
Ogni restart verifica cessazione dell'istanza precedente e dell'ausiliario, stato RELEASED
ed endpoint rimosso; ogni stop verifica cessazione del successore, socket chiuso, risorse
rilasciate e daemon lease libero. Il cleanup attende anche la cessazione del controller.

## Problemi emersi e corretti

1. Il client poteva restituire un vecchio successo prima del rifiuto di un nuovo payload
   con lo stesso ID. Ora confronta l'azione e attende l'ammissione del controller.
2. Sotto dieci retry, il bootstrap BUSY poteva arrivare durante una lettura dello stato:
   veniva classificato come uscita prima dell'accettazione. Il report viene valutato
   dopo quella lettura; la prova concorrente finale passa.
3. La preparazione dello shutdown era registrata entrando STOPPING. Ora viene persistita
   dopo il drain; il controller finalizza solo dopo la cessazione.
4. La review del gate ha richiesto resourceId nella risposta BLOCKED: aggiunto al dato vivo
   e all'ispezione offline, mantenendo redazione di endpoint e credenziali.
5. Le fixture iniziali avevano un percorso relativo al sandbox e nessun handle referenziato
   durante l'attesa del bootstrap; sono state corrette. Una successiva esecuzione 60/61
   esponeva un'asserzione prematura: STOPPED può precedere il commit dell'esito del controllo.
   La prova ora attende entrambe le condizioni. Queste esecuzioni non sono conteggiate come PASS.

Le failure RED T033–T036 sono intenzionali e precedono le rispettive implementazioni.
Le due campagne finali non contengono errori o timeout esclusi dai percentili.

## Stato dei gate e limiti

- US2-A1–A5: PASS per il lavoro Foundation attualmente eseguibile. Non ci sono job applicativi
  ulteriori da drenare; l'ammissione di nuove risorse viene bloccata fuori da RUNNING.
- SC-001: PASS sul carico e sulla piattaforma sopra dichiarati.
- SC-006: prova parziale di isolamento e cleanup; campagna completa rinviata ai task previsti.
- SC-002–SC-005 e SC-007–SC-010: campagne complete **NOT_RUN**; presenti soltanto prove funzionali parziali.
- Recovery di crash daemon/controller, riconciliazione di orfani, 30 crash e carico di
  1.000 operazioni: US3, T046–T058, ancora da implementare.
- Diagnostica estesa, eventi durevoli, streaming, replay e backpressure: US4, ancora da implementare.
- Nessun provider, Agent Runtime, Git/worktree, gestione dipendenze di progetti o Electron.
- Benchmark idle/RSS/CPU, test con UID distinti e validazione completa multipiattaforma
  non sono stati eseguiti. L'implementazione supporta la prima piattaforma prevista.

Checkpoint US2 pronto per review. Nessuna fase successiva, pubblicazione o integrazione
remota è stata avviata. Hook Git post-implement facoltativo: i commit sono quelli per task
richiesti dall'utente, senza commit aggregato aggiuntivo.
