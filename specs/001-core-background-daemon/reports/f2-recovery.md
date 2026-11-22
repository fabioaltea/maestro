# F2 recovery — checkpoint US3 / T058

**Data**: 2026-11-08. **Branch**: `001-core-background-daemon-implementation`.
**Esito**: PASS US3, T046–T058; avanzamento T001–T058 su 87 task.
La feature conserva 29 task aperti, a partire da US4.

## Evidenze finali

- `npm run typecheck`: PASS. `npm run lint`: PASS dei confini architetturali.
- `npm test`: **91/91 PASS**, zero test falliti, saltati o cancellati, dopo le correzioni finali del gate.
- `node --test dist-tests/tests/acceptance/recovery.test.js`: **33/33 PASS**
  (30 sottocasi, il test contenitore e due prove aggiuntive), nessun errore escluso dai campioni.
- Matrice: **30 scenari**, **34 processi interrotti realmente**, inclusi i daemon iniziali
  delle quattro prove con secondo crash durante recovery. Due ulteriori crash appartengono
  alle prove di carico e di proprietà incerta: **36 complessivi** nella campagna.
- **1.000 esiti confermati confrontati integralmente**, digest prima/dopo identici,
  zero perdite o modifiche. Dieci ausiliari sopravvissuti vengono riconciliati e rilasciati.
- Ogni retry riuscito conserva esattamente l'operazione e il successore del risultato
  già verificato; nessuna ripetizione cieca dello spawn o di un vecchio restart.
- Il processo estraneo reale rimane vivo durante il blocco; la fixture si chiude soltanto
  sul proprio canale privato di test. Il retry esplicito successivo riesce.

La campagna misurata è quella di T057, commit `a542d84`, package `0.1.0`; le verifiche
finali di T058 aggiungono il rifiuto di una copia dello store in altro percorso e la
presentazione esplicita della liveness nella CLI umana. I tempi di questa campagna non
sono una nuova misura dei 30 cicli ordinari documentati in [f2-control.md](f2-control.md).

## Ambiente, metodo e risultati osservati

macOS 26.3.1 arm64/APFS, Apple M3,
8 CPU logiche, 8 GiB RAM;
Node 26.13.0, TypeScript 6.0.3, better-sqlite3 13.0.3.
Archivio locale temporaneo dedicato, nessuna rete o UI. La campagna è stata eseguita
separatamente dalla suite concorrente. Il runner di accettazione ora esegue i file
sequenzialmente per separare le misure di campagne diverse.

I crash sono uscite anomale reali con codice 86 in processi fixture, ai checkpoint
controllati da `FaultSchedule`. Il test non invia segnali a PID ricavati dallo stato.
Le porte e i checkpoint sono dipendenze iniettate dal codice delle fixture; nessuna
opzione CLI o RPC pubblica abilita fault, esecuzione arbitraria o terminazione forzata.

Misura UTC: `2026-11-08T16:59:07.035Z`. Ogni tempo decorre dalla richiesta CLI successiva
al crash osservato e include il processo client compilato e la risposta JSON. I tempi
di preparazione dello storico e di confronto successivo sono separati dal recupero.
I percentili della matrice usano nearest rank; la matrice comprende controlli start e stop.

| Prova | Carico / n | Obiettivo | Misurato | Esito |
|---|---|---|---|---|
| Matrice crash | 30 richieste dopo crash | esito verificato o BLOCKED entro 30.000 ms | p95 401.89 ms; max 513.93 ms | 30/30 PASS |
| Recovery caricato | 1.000 esiti + 10 ausiliari | operativo o diagnosi entro 30.000 ms | 869.48 ms, operativo | PASS |
| Proprietà incerta | 1 processo estraneo vivo | blocco motivato, zero terminazioni | 218.84 ms, exit 4 | PASS |
| Conservazione | confronto di 1.000 record completi | zero differenze | zero differenze | PASS |

Digest SHA-256 prima e dopo: `b234e95d457e0f02675d89fc9a7ee7f2e270c071b3b5ef2362e025973bcc573c`.
Campioni individuali, piattaforma, esiti e caso bloccato:
[f2-recovery-samples.json](f2-recovery-samples.json).
Il caso incerto conserva resourceId, observation=UNKNOWN, releaseState=BLOCKED e nextAction;
il teardown rimuove soltanto le fixture proprie dopo prova di cessazione.

## Distribuzione dei crash

| Checkpoint | Scenari | Esito |
|---|---:|---|
| `control.beforeAccept` | 3 | PASS |
| `control.accepted` | 3 | PASS |
| `control.ticketIssued` | 2 | PASS |
| `control.spawned` | 2 | PASS |
| `control.ready` | 2 | PASS |
| `control.completed` | 2 | PASS |
| `control.stopRequested` | 2 | PASS |
| `control.stopObserved` | 2 | PASS |
| `recovery.beforeCleanup` | 2 | PASS |
| `recovery.afterCleanup` | 2 | PASS |
| `daemon.claimed` | 2 | PASS |
| `daemon.recorded` | 2 | PASS |
| `daemon.recovering` | 2 | PASS |
| `daemon.running` | 2 | PASS |

Prima/dopo commit intento, ticket e spawn coprono accettazione persa, candidati ritardati
ed effetti avvenuti senza risposta. I checkpoint del daemon coprono claim senza record,
record senza endpoint, RECOVERING interrogabile con ready=false e RUNNING non finalizzato.
Le due posizioni di cleanup dimostrano la ripetibilità dopo un secondo crash durante recovery.

## Invarianti verificati

1. Sotto control lease, si osservano istanza, ticket e stato reale. Soltanto lo stesso
   requestId e la stessa azione possono proseguire un effetto ancora da compiere.
   Un controllo differente può finalizzare un effetto già verificato; un nuovo stop può
   annullare ticket ISSUED e interrompere il vecchio intento senza proseguirne lo start.
2. Un ticket CLAIMED non viene sostituito senza prova di cessazione del reclamante.
   La sostituzione conserva l'identità preassegnata e incrementa generation; un candidato
   annullato tardivo non può reclamare il ticket. Gli esiti terminali restano immutabili.
3. La riconciliazione di un'istanza assente richiede anche il daemon lease. Il cleanup
   usa percorsi verificati, UID/inode e prova di socket non più in ascolto; endpoint vivi,
   file regolari e identità incerte bloccano senza cancellazioni.
4. Gli orfani Foundation cooperano sul proprio canale autenticato. PID presente o EPERM
   non provano proprietà. Controller e scope diversi restano esclusi dalla policy;
   nessun vincolo di terminazione viene aggiunto al futuro Agent Runtime.
5. Il bootstrap attraversa RECOVERING e non finalizza il controllo del controller.
   Readiness positiva richiede RUNNING e handshake valido dell'identità/generazione attesa.
6. Se lo storage worker muore, il daemon mantiene il lease nel main e risponde
   VOLATILE/BLOCKED, ready=false, causa WORKER_EXIT e persisted=false. Un controller perso
   prima del commit lascia l'operazione riconciliabile e produce UNKNOWN_OUTCOME.
7. Status e operation restano read-only: revisione invariata, pendingFinalization e
   liveness del controller espliciti; nessuna recovery mutante da una consultazione.
   Stato storico RUNNING con daemon assente resta LAST_KNOWN/ABSENT_VERIFIED/ready=false,
   anche nell'output umano. Gli errori osservati non vengono spacciati per persistiti.
8. Archivi corrotti, incompatibili e copie con canonicalPath discordante vengono rifiutati
   preservando i byte. Write failure e readonly non producono conferme di mutazione.
   Nessun reset, ricreazione vuota o pruning degli esiti è introdotto.

## Anomalie trovate durante lo sviluppo

- Le prove RED T046–T049 fallivano sui contratti ancora assenti, prima dell'implementazione.
- Una fixture orphan usava un adapter nuovo senza registrare il runtime verificato:
  corretta per condividere l'adapter che canonicalizza il proprio archivio.
- Una suite intermedia aveva **88/90 PASS**: la nuova osservazione della cessazione del
  controller poteva leggere ancora uno snapshot IN_PROGRESS precedente al commit finale.
  Ora rilegge lo stato dopo la cessazione prima di dichiarare CONTROL_INTERRUPTED.
  L'altro fallimento era il vecchio contratto che vietava qualunque campo cause; aggiornato
  al requisito US3 di cause enumerate e redatte, verificando il rifiuto di cause arbitrarie.
- La review finale ha aggiunto il rifiuto dello store copiato in un altro percorso prima
  di qualsiasi recovery, e ha reso esplicita la liveness nell'output umano di status.
  La suite finale **91/91 PASS** comprende entrambe le regressioni.

Le esecuzioni intermedie fallite non sono conteggiate come PASS. La campagna finale T057
ha zero anomalie, zero timeout e nessun campione scartato.

## Gate e lavoro restante

- US3-A1–A5: PASS per il perimetro Foundation implementato.
- SC-004 e SC-005: PASS sulle prove e sul carico documentati; target e campioni restano distinti.
- SC-006: prove di isolamento, processi incerti, cleanup e autorizzazione passate; il runner
  con UID distinti rimane NOT_RUN e impedisce di dichiarare completo il criterio complessivo.
- SC-001: evidenza US2 conservata; non rimisurato in questa campagna.
- SC-002, SC-003 e SC-007–SC-010: campagne complete ancora NOT_RUN; presenti prove parziali.
- ENOSPC/readonly/IO sono coperti con errori driver simulati, trigger nativo di rifiuto
  scritture e worker reali terminati. Non è stato riempito il disco dell'utente.
- I crash riproducibili di processo non equivalgono a una prova di perdita fisica di alimentazione.
- Diagnostica estesa, eventi persistenti, streaming, replay e backpressure appartengono a US4.
- Nessun provider, Agent Runtime, Git/worktree, gestione dipendenze di progetti, pnpm o Electron.

Checkpoint US3 pronto per review. US4 non è stato avviato; nessuna pubblicazione o merge.
Hook Git pre/post implement facoltativi: usati i commit per task autorizzati, senza commit
aggregato aggiuntivo. La Constitution non è stata modificata.
