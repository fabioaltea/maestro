# maestro Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-11-08

## Active Technologies

- TypeScript 6.0.3 strict, Node.js 26.13.0 LTS, ESM/NodeNext; better-sqlite3 13.0.3; API native Node (001-core-background-daemon).
- SQLite locale con WAL e synchronous FULL; lease separati; journal eventi e outbox previsti da US4.

## Project Structure

```text
src/
tests/
```

## Commands

Build, typecheck, lint, test ordinari e accettazione dei cicli di controllo disponibili.
Accettazione completa e bench:foundation restano previsti dai task successivi:

```sh
npm run build
npm run typecheck
npm run lint
npm test
npm run test:contract
npm run test:integration
npm run test:acceptance
npm run bench:foundation
```

## Code Style

TypeScript strict, ESM/NodeNext. Dominio e client non importano adapter OS o driver SQLite.

## Recent Changes

- 001-core-background-daemon: T001–T058 implementati e committati per task; checkpoint US3.
  Controllo locale, recovery conservativo di daemon/controller, ticket con generation,
  ausiliari autenticati e osservazione VOLATILE su perdita dello storage worker.
  91 test ordinari passati; campagna US3: 30 scenari, 1.000 esiti e dieci ausiliari.
  Evidenze e limiti in reports/f2-recovery.md. Eventi e diagnostica estesa restano in US4.

<!-- MANUAL ADDITIONS START -->

La Constitution in `.specify/memory/constitution.md` è vincolante. La feature corrente è
`specs/001-core-background-daemon/`; consultare plan.md, data-model.md e contracts prima
di modifiche. Prima piattaforma: macOS 26.3 arm64/APFS; le primitive OS restano dietro porte.
Non eseguire cleanup, implementazione o fasi successive senza la relativa richiesta.
Le soglie della specifica sono target; soltanto i report dei checkpoint attestano le misure effettive. Provider, Agent Runtime,
worktree, gestione dipendenze di progetti ed Electron sono fuori scope della Foundation.

<!-- MANUAL ADDITIONS END -->
