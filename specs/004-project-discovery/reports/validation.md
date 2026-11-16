# Validation004 — evidenze di implementazione

## Stato

Implementazione avviata2026-11-16 sul branch004-project-discovery, basee9c8491.
Nessuna qualifica reale provider, login, installazione o invio di sorgenti eseguiti.
I gate001/002 e la review umana003 restano invariati.

## T001 — setup e confini

- macOS26.3.1(a), build25D771280a, Darwin25.3.0, arm64; Node26.13.0, npm11.20.0.
- Pin Codex controllato read-only: CLI0.167.0, SHA256
  `030316ecfbb41f4e7946e584b0063ef333b7a36cd312ba349f2f6869e39b62cc`.
  Help conferma no-daemon/ignore-user-config/ignore-rules/ephemeral/output-schema.
  Version/help non dimostrano i permessi effettivi o il login.
- Probe OS minimale sandbox-exec→true: exit0. Non è G0, che richiede il provider
  reale e tentativi ostili con backend sintetico.
- Ignore verificati per repository Node/desktop: dipendenze, build, env/segreti,
  database/runtime e risultati test. Nessun Docker/ESLint/Prettier/Terraform/Helm
  rilevato, package private non pubblicato: nessun ignore ulteriore necessario.
- Guard AST estesa alla zona providers; dominio/client non possono importarla.
  Adapter provider non importano storage/core/platform/Electron/SQLite. Asset
  Discovery `.sb`/`.schema.json` copiati nei soli output previsti dallo script esistente.
- PASS `npm run build`, `npm run build:test`, `npm run typecheck`, `npm run lint`.
- PASS `node --test dist-tests/tests/contract/architecture.test.js`:3/3,0skip.
  Comprende import statici/dinamici/re-export/require, modulo non statico,
  dipendenze vietate provider e regressione dominio/client.
- Nessun package/lockfile/runner nuovo; lockfile desktop preesistente non tracciato
  lasciato fuori dalle modifiche. G0/G1 NOT_RUN; nessuna soglia runtime misurata.
