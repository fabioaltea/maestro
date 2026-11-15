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
