# Desktop Core UI — validation

## G0 — 2026-11-15 — PASS locale

Baseline core integrata7238137; sviluppo sul branch003-desktop-core-ui.
macOS Darwin25.3.0 arm64/APFS; Node26.13.0, Electron45.3.0, React19.3.1,
esbuild0.28.2, Playwright1.65.0. Nessuna modifica a dominio/schema/protocollo core.

- `npm run build`, `npm run typecheck`, `npm run lint`: PASS.
- `npm run typecheck:desktop`, `npm run build:desktop`: PASS.
- `npm run test:desktop:unit`:9 PASS,0FAIL/skip. Contratti/schema/sender,
  guard AST ostile, ambiente/argv, risposta CLI reale, stdout/stderr bounded,
  watchdog, UNKNOWN dopo perdita risposta mutativa e rotazione log2file.
- Playwright Electron:3 PASS,0FAIL/skip. Bootstrap React, sandbox OS misurata
  con app.getAppMetrics(), assenza Node nel renderer, API congelata, noautostart,
  input ostile/rete/window.open/traversal/navigazione negati, mittente finestra
  estranea respinto tramite IPC reale.
- Prima dei relativi incrementi eseguiti RED attesi: moduli bridge/CLI mancanti,
  app non compilata e guard che non esaminava desktop; poi relativi test PASS.

Limite harness: dopo una navigazione cancellata Playwright può mantenere un frame
provvisorio vuoto. Il test verifica getURL e documento reale tramite webContents,
compresi titolo, heading e location; non rimuove il controllo di navigazione o
l'isolamento. Le altre interazioni UI usano normali locator Playwright.

Non è accettazione finale003: US1–US4 e SC-001–007 ancora NOT_RUN.
001/T082,001/T085 e002/T093 restano aperti/BLOCKED nei report core;
questa verifica non qualifica runner UID/macchina o campagna IP-denied.

## G1 / US1 — 2026-11-15 — PASS locale

- Unit reducer:2 PASS su epoch, null, cache e risposte obsolete.
- Integrazione adapter reale:2 PASS su archivio assente/live/offline, snapshot
  invariato e risposta di selezione precedente respinta.
- Electron:2 PASS;100repository reali registrati,4pagine da25,100identità
  raggiungibili senza omissioni/duplicati, dettaglio datato, navigazione indietro,
  letture a daemon fermo senza modifiche all'archivio. Archivio assente non creato.
- La qualificazione100progetti ha esposto OUTPUT_LIMIT nel reader core: aggiunta
  proiezione storage interna bounded20+truncated, query21righe e4campi pubblici.
  Limite64KiB e listResources ownership/recovery restano invariati. Test275risorse
  PASS con snapshot DB invariato. Modifica motivata nell'adeguamento del piano.
- Prima regressione core:367 PASS/1FAIL su368, admission pressure con timeout
  client1s sotto carico parallelo. Ripetizione isolata:3 PASS. Il test ora osserva
  per5s l'ammissione reale, conservando cap32, probe4, limiteletture2s e stop10s.
  Ripetizione completa npm test:368 PASS,0FAIL/skip in132289.423416ms. Campioni
  rigenerati conservati sotto core-regression-samples; report002 preservati.
- Launcher e harness risolvono il binario Electron installato senza importare il
  loader npm che scaricherebbe automaticamente il binario se assente.

SC-001/002: funzionalità qualificate, campagna30campioni ancora NOT_RUN (T056).
US2–US4 non ancora implementate. Nessun gate esterno001/002 promosso.

## G2 / US2 — 2026-11-15 — PASS locale

- Conferme:2unitari PASS su TTL60s, owner/frame/epoch/store, immutabilità e
  consumo monouso; blocchi delle operazioni equivalenti ancora incerte.
- Pipeline:3integrazioni PASS su ricevuta durevole prima dell'effetto, doppio
  invio, perdita della risposta, archivio sostituito e scrittura ricevuta fallita
  senza alcuna chiamata mutativa.
- Ricevute/recovery:4integrazioni PASS su100ricevute, mode0700/0600, fsync,
  errori, symlink/corruzione, UUID originale, store diverso e query non trovata
  mantenuta UNKNOWN. Temporanei da aggiornamento interrotto non nascondono
  ricevute stabili; nuovi invii bloccati, rimozione solo con dismiss terminale
  esplicita. Nessun comando viene ripetuto dal recupero.
- Lifecycle CLI reale:1PASS con start/restart/stop, un ID per azione, chiusura
  client e daemon superstite. Unit lifecycle1PASS, teardown solo handle posseduti.
- Bridge Electron reale1PASS con prepare senza effetti, confirm e metadati
  privati non esposti al renderer. UI visibile:4scenari E2E PASS (3nella campagna
  lifecycle,1prova di risposta persa separata), compresi annullamento, ricevute,
  10cicli start/close/reopen/stop, SIGKILL main e recupero originale.
- SC-003:10/10daemon superstiti; stop massimo1055.2777079999796ms, tutti≤12s.
  Campioni reali in lifecycle-samples.json; non è una garanzia su altre macchine.
- Risposta persa reale: fermato soltanto il main Electron posseduto tramite
  SIGSTOP dopo rilevamento del suo client CLI; daemon completa indipendentemente.
  SIGKILL main, ricevuta PREPARED originale ancora leggibile, riapertura query-only
  →TERMINAL/SUCCEEDED e una sola ricevuta. Nessun hook/bypass nel bundle normale.

US3 e US4 ancora da implementare; SC-001/002/005/006/007 campagna finale NOT_RUN.
Gate esterni001/002 invariati. Nessun push, release o integrazione remota.

## G3 / US3 — 2026-11-15 — PASS locale

- Contratti picker/offline:2 PASS; percorso importabile solo tramite handle
  corrente, omissione/null base distinti, mutazioni offline senza effetti/ricevute.
- Integrazione reale:2 PASS; conflitti Git preservati, duplicati, CAS prima
  dell'invio, patch atomica, remove/reimport con UUID nuovo, unborn e checkout
  spostato osservati senza rebind.
- Unit effetto UI:1 PASS; soltanto esiti confermati aggiornano la vista, UNKNOWN
  non prende in prestito un effetto dichiarato nel payload. Elenco/dettaglio
  riletti dal core e risposte obsolete scartate per generazione.
- Electron mirato:3 PASS su importazione, untracked/unavailable, errori datati,
  annullamento, revisione cambiata dopo conferma, rilettura e nuova approvazione,
  rimozione della sola registrazione e reimportazione.
- SC-004:20sequenze complete UI import/verify/update/remove PASS in2.3min,
  confronto CLI dopo update/remove e snapshot di ogni repository identico prima
  e dopo gli effetti. Campioni in project-action-samples.json. Ricevute bounded.

US4 e qualificazione finale ancora da completare; gate esterni001/002 invariati.

## US4 E1 — 2026-11-15 — PASS locale

Contratto storia1PASS, FIFO1PASS, integrazione storia/diagnostica reale1PASS,
Electron offline1PASS. Pagine store-bound e payload redatti, nessuna scrittura
all'archivio fermo. Distinti errore di lettura e storia vuota verificata.
La navigazione rapida rilascia solo i client read-only della vista precedente;
query di recovery e comandi mutativi restano indipendenti. Test ownership1PASS
con processo reale; contesa locale read prima dello spawn limitata a5tentativi
e500ms di attesa, test dedicato PASS. Cap2letture/1mutazione invariato.
Streaming/replay/pressione non ancora qualificati (E2–E4).

### E2 — storia → live (T044–T047)

2026-11-15: unit/contract desktop23 PASS; typecheck/build desktop e guard architettura PASS.
`activity-live.test.ts`: CLI/core reali, passaggio contiguo dalla pagina storia, nessun duplicato;
il checkpoint main resta invariato fino all’ACK; chiusura del solo client lascia LIVE_VERIFIED.
`activity-live.spec.ts`: Electron reale, eventi prodotti da project add visibili, unsubscribe e daemon superstite:1 PASS.
Prima esecuzione dei due nuovi test: assertion liveness errata (`LIVE` anziché `LIVE_VERIFIED`); corrette le sole assertion, ripetizione PASS.
E2 qualificato; replay e pressione richiedono ancora E3/E4.

### E3 — replay e gap (T048–T050)

4 integrazioni PASS: duplicate discard/conflict, seq/store, subprocess exit, callback fallita senza avanzamento ACK, CURSOR_EXPIRED con bounds validati.
2 E2E Electron PASS: restart del daemon reale e replay senza duplicati; retention floor scaduto impostato soltanto nella fixture posseduta a daemon fermo, errore CURSOR_EXPIRED emesso dalla CLI/core reali, nuova lettura esplicita e ritorno live.
La prima prova E2E falliva nel teardown per doppia chiusura Playwright; corretta ownership della chiusura, ripetizione2 PASS. Nessun cursore persistito, nessun retry mutativo.

### E4 / G4 — qualifica funzionale ridimensionata (T051–T053)

L’utente ha autorizzato2026-11-15 di rinviare benchmark prolungati/grandi volumi e
mantenere ordine, recovery e limiti per la prima UI. Spec/plan/research/tasks/quickstart
aggiornati, senza rimuovere protezioni già verificate. Nessun generatore sintetico
resta nella distribuzione o nella suite.

4 integrazioni pressione PASS: backlog256KiB, FIFO500/4MiB, ACK mancante (~2s),
ACK errato e ACK duplicato anche col batch successivo pendente. Cursore non avanza
senza ACK valido. E2E CLI/core/Electron reali:10operazioni,20eventi tutti osservati,
controlli da tastiera utilizzabili, p95/max3ms sul campione locale (incertezza di
scheduling fra osservatori, non throughput). G4 PASS nello scope rivisto.
Campagne lunghe fallite/interrotte e limite di stabilità non qualificata dichiarati
in performance.md; nessuna falsa promozione delle prove precedenti.

### T054 — accessibilità automatica PASS, review manuale aperta

Electron reale a finestra1280×800: flussi primari attivati da tastiera, Tab/Shift+Tab
nel dialog, Escape e ritorno focus, errori associati/input conservato, testo HTML
ostile inerte, cinque viste con contrasto≥4,5:1:1 E2E PASS. Corretto ritorno del
focus catturando il trigger prima di disabilitarlo durante prepare. Una race del test
(Escape prima dell’apertura del dialog) corretta attendendo il dialog visibile.
Screenshot e conteggi contrasto in reports/screenshots/, ispezione visiva locale eseguita.

**T054 resta aperto** per la review umana/picker nativo reale: NOT_RUN, istruzioni
concrete in manual-review.md. Non è simulata dalla sostituzione dei dialog nei test.
SC-006 non completamente qualificato finché manca questa evidenza.

### T055 — privacy e confini PASS

2 E2E PASS: input path/argv/ACK/conferma ostili negati; nessuna esposizione di dati
privati/credenziali in diagnostica/log; mutazione offline negata senza scritture;
cambio archivio invalida token ed epoch senza ridirigere l’intento approvato.
Contratti log: cap reale2MiB×2 più rotazioni ripetute256byte, codici/UUID/esiti sicuri,
no stderr/raw payload, file privati non hardlink, correlazione UUID dell’operazione;
schema chiuso prima della serializzazione degli input. Suite unit/contract26 PASS.
Le race ricevute/store e i permessi core restano coperti dalle integrazioni già
registrate; test Electron foreign sender/frame/CSP separati in security.spec.ts.

### T056 — SC-001/002 PASS sul campione

1 E2E dedicato PASS:30aperture reali,100progetti raggiungibili,30dettagli live e30offline,
freschezza/observation LAST_KNOWN corrette e snapshot offline invariato. Tempi raw,
definizione conservativa e p95/max in view-performance-samples.json e performance.md.
Campagna isolata dopo le verifiche funzionali, senza altre prove di performance.

### T057 — regressione finale PASS

2026-11-15: build e typecheck core/desktop, guard AST PASS. npm test core368 PASS,
0FAIL/skip (137208,114416ms); unit/contract desktop26 PASS; integrazioni desktop22 PASS;
E2E Electron22 PASS (5,3min), più la campagna performance1 PASS eseguita separatamente
in T056 e non ripetuta senza motivo. Nessuna suite acceptance/idle600s o rete/UID
esterna rilanciata. Comandi/contatori/ambiente in final-verification.json.

Ripetuti lifecycle10cicli: daemon10/10superstite, stop massimo1014,12ms; registrazioni
20sequenze con snapshot/parità. Campioni aggiornati nei relativi JSON. Nuova misura
funzionale eventi in event-core-samples.json/performance.md. Screenshot automatici
aggiornati; review umana ancora NOT_RUN. Campioni prodotti dai test core copiati
sotto003/core-regression-samples; report002 ripristinati ai byte precedenti.
Core senza UI qualificato da npm test e dal guard degli import; nessun Electron
caricato dal runtime headless. I gate di release001/002 restano invariati.
