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
