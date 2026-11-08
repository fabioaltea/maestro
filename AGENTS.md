# maestro Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-11-08

## Active Technologies

- TypeScript 6.0.3 strict, Node.js 26.13.0 LTS, ESM/NodeNext; better-sqlite3 13.0.3; API native Node (001-core-background-daemon).
- SQLite locale con WAL e synchronous FULL; lease separati; schema 2 con outbox e journal eventi bounded.

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

- 001-core-background-daemon: T001–T072 implementati e committati per task; checkpoint US4/E2.
  Eventi durevoli, diagnostics/events read-only e streaming live autenticato con --follow.
  Backpressure aggregata <=1 MiB per osservatore; stop del client separato dal lifecycle.
  Schema 2 invariato; 115 test ordinari passati. E2: due osservatori, 8.192 eventi e 30 status.
  Campioni e limiti in reports/e2-stream.md. Replay e cursori pubblici restano in E3.

<!-- MANUAL ADDITIONS START -->

La Constitution in `.specify/memory/constitution.md` è vincolante. La feature corrente è
`specs/001-core-background-daemon/`; consultare plan.md, data-model.md e contracts prima
di modifiche. Prima piattaforma: macOS 26.3 arm64/APFS; le primitive OS restano dietro porte.
Non eseguire cleanup, implementazione o fasi successive senza la relativa richiesta.
Le soglie della specifica sono target; soltanto i report dei checkpoint attestano le misure effettive. Provider, Agent Runtime,
worktree, gestione dipendenze di progetti ed Electron sono fuori scope della Foundation.

<!-- MANUAL ADDITIONS END -->
