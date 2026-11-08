# Quickstart e verifica — Foundation

Documento per la futura implementazione. Nessuna installazione, build o prova di daemon
è stata eseguita durante la pianificazione. I comandi diventano disponibili con F0/F1.
Root del repository: `/Users/fabioaltea/Repository/maestro`.

## Prerequisiti e comandi previsti

macOS 26.3 arm64, filesystem APFS locale, Node 26.13.0 e dipendenze del lockfile F0.
La prima piattaforma va verificata nel bootstrap; nessuna promessa di supporto ad altri OS.
I test creano archivi temporanei e li ripuliscono solo dopo aver verificato processi e
file propri. Nessuna pulizia della vecchia codebase è implicita.

```sh
cd /Users/fabioaltea/Repository/maestro
npm ci
npm run build
npm run typecheck
npm run lint
npm test
npm run test:contract
npm run test:integration
npm run test:acceptance
npm run bench:foundation
```

Script pianificati: build=`tsc -p tsconfig.json`; typecheck e lint usano il compiler e
il controllo dei confini d'import; test esegue node:test sul codice compilato.
Le suite test:contract/test:integration/test:acceptance selezionano le rispettive directory.
bench:foundation produce report, non modifica le soglie o i test per farli passare.
F0 deve creare questi script: ora non esistono e non vanno invocati come se fossero disponibili.

## Prima slice F1

Archivio dimostrativo separato: `/private/tmp/maestro-foundation-demo`.
Verificarne l'assenza prima dell'esercizio; non sovrascrivere un archivio già presente.

```sh
node dist/cli/main.js daemon start --state-dir /private/tmp/maestro-foundation-demo --json
node dist/cli/main.js daemon status --state-dir /private/tmp/maestro-foundation-demo --json
```

Annotare storeId e instanceId, chiudere il terminale iniziale dopo la fine della CLI,
aprire un altro terminale e ripetere status. La stessa istanza deve essere pronta.
Il test automatico copre anche terminazione anomala del processo CLI e disconnessione
di tutti i client, senza segnali inviati al daemon per simulare la chiusura del terminale.

```sh
node dist/cli/main.js daemon stop --state-dir /private/tmp/maestro-foundation-demo --json
node dist/cli/main.js daemon status --state-dir /private/tmp/maestro-foundation-demo --json
```

Stop deve provare la cessazione e restituire esito durevole; status non riavvia nulla.
F1 è completato quando questo percorso, dieci avvii concorrenti e il rifiuto di accessi
non autorizzati passano. F1 non certifica ancora l'intera feature.

## Retry e osservabilità dopo F2/E1–E3

```sh
node dist/cli/main.js daemon restart --state-dir /private/tmp/maestro-foundation-demo --request-id 5fc02636-f95e-4ee8-9969-2a7e0c2478f0 --json
node dist/cli/main.js daemon operation 5fc02636-f95e-4ee8-9969-2a7e0c2478f0 --state-dir /private/tmp/maestro-foundation-demo --json
node dist/cli/main.js daemon diagnostics --state-dir /private/tmp/maestro-foundation-demo --json
node dist/cli/main.js daemon events --state-dir /private/tmp/maestro-foundation-demo --limit 100 --json
node dist/cli/main.js daemon events --state-dir /private/tmp/maestro-foundation-demo --follow --json
```

Ripetere lo stesso restart con lo stesso ID restituisce l'operazione originaria, senza
un secondo restart. Un nuovo intento richiede un nuovo ID. Le prove di replay passano
il cursore dell'ultimo frame realmente ricevuto tramite --after.
Un cursore scaduto deve produrre lacuna esplicita e possibilità di rileggere status.

## Matrice di accettazione e misure

| Criterio | Esecuzione richiesta e risultato atteso |
|----------|----------------------------------------|
| SC-001 | 30 cicli ordinari; almeno 95% entro start 5 s / stop 10 s / restart 15 s; stop non completato dà blocco entro 10 s |
| SC-002 | 10 client, 1.000 letture; almeno 95% entro 500 ms e tutte entro 2 s con dato o errore esplicito |
| SC-003 | 100 prove da 10 start simultanei; zero proprietari doppi. 100 retry con lo stesso ID; zero effetti duplicati |
| SC-004 | Almeno 30 crash distribuiti fra start, modifica, stop e recovery; zero perdita di esiti confermati o ripetizioni alla cieca |
| SC-005 | 1.000 operazioni e fino a 10 ausiliari; entro 30 s RUNNING oppure diagnosi di blocco |
| SC-006 | Identità incerte/PID reuse, accessi negati e processi estranei; zero effetti indebiti, zero ausiliari residui per stop riuscito |
| SC-007 | 10 osservatori, 100 eventi/s per 60 s; almeno 95% entro 1 s; client fermo non compromette SC-002; replay o gap esplicito |
| SC-008 | Suite senza rete/UI; CLI chiusa normalmente o anormalmente, terminale chiuso e tutti i client disconnessi; stessa istanza per almeno 10 minuti |
| SC-009 | Idle 10 minuti: RSS totale daemon inclusi worker <=150 MiB, CPU media <=1% di un core; saturazione diagnostica <=50 MiB +5 MiB temporanei, coda client <=1 MiB; zero segreti sentinella |
| SC-010 | Tutte le categorie di errore, help, codici d'uscita e concordanza umano/JSON; attese di controllo entro 30 s senza cancellazione implicita |
| AR-001 | Confini d'import, test sostitutivi delle porte OS e integrazione sulla prima piattaforma |
| AR-002 | Policy Foundation separata da primitive OS; nessuna terminazione universale dei figli |
| AR-003 | E1, E2 ed E3 hanno prove autonome; backpressure presente già in E2 |

Ogni fault di crash punta a una fase: prima/dopo commit dell'intento, prima/dopo claim
del ticket, dopo spawn prima di readiness, dopo effetto prima di esito, dopo append/sync
prima di clear outbox, durante stop e durante un secondo recovery. Le fixture appartengono
solo all'harness: nessun flag di fault disponibile nel prodotto.

Per il test reale di UID separati serve un secondo account di test predisposto;
la suite ordinaria usa credenziali negate e permessi verificati, mentre il gate di
accettazione multi-utente deve essere eseguito su runner dedicato. Non dichiararlo
superato sulla sola base dei mock.

## Formato del report futuro

Per ciascun SC: commit/versione del software, runtime/driver, OS/architettura, CPU/RAM/disco,
workload, numero campioni, unità, target, p50/p95/max quando applicabili, osservato,
pass/fail e motivo. Per quote disco misurare byte fisici di tutti i file/sidecar diagnostici
e massimi temporanei; includere file ancora aperti dopo unlink.
Riportare errori/timeout fra i campioni, senza escluderli per migliorare i percentili.

**Stato attuale delle misure**: NOT_RUN per tutti gli SC. La validazione del piano verifica
soltanto completezza/coerenza documentale e non attesta performance o crash safety reali.
