# maestro Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-11-10

## Active Technologies

- TypeScript 6.0.3 strict, Node.js 26.13.0 LTS, ESM/NodeNext; better-sqlite3 13.0.3; API native Node (001-core-background-daemon).
- SQLite locale con WAL e synchronous FULL; lease separati; schema 3 con outbox e journal eventi bounded.
- 002-project-registry (implementazione in corso): Git Xcode 2.50.1 (Apple Git-155) verificato tramite xcrun; adapter macOS di ispezione confinata qualificato G1. Schema 3 e upgrade esclusivo implementati nello stesso store. Nessuna dipendenza runtime aggiunta.

## Project Structure

```text
src/
tests/
```

## Commands

Build, typecheck, lint, suite ordinarie e accettazione disponibili.
`npm test` non include acceptance. Acceptance e bench:foundation includono una prova
idle reale di dieci minuti; eseguire i carichi separatamente, senza sospendere il Mac:

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
- 002-project-registry: T001–T028 conclusi, G1 e primo incremento E1 PASS, 207 test ordinari verdi;
  registro e CLI non ancora disponibili. Feature selezionata da `.specify/feature.json`: consultare
  `specs/002-project-registry/`. Import da worktree esistenti senza gestione worktree;
  readiness Foundation T082/T085 restano gate finali; per sviluppo locale basta
  baseline verde. Codec registry disponibili, dispatch/CLI ancora da implementare.
  Implementazione autorizzata; un commit locale per task. Nessun push implicito.

- 001-core-background-daemon: Foundation implementata; diagnostica con categorie
  esplicite, dieci osservatori/6.000 eventi e 1.000 letture, 100 round di dieci start
  e 100 retry verificati. Replay/live e backpressure restano bounded; schema 2 invariato.
  Ultimo idle: 600s, massimo RSS campionato 76,56 MiB inclusi worker, CPU 0,00833% di
  un core. Recovery con 1.000 record e dieci ausiliari verificato; campioni nei report.
  Non dichiarare 001 completamente accettata: T082/FR-016 NOT_RUN, T085 offline bloccato.
  La campagna completa IP-denied ha 35 PASS/11 FAIL/1 SKIP; riprove mirate senza sandbox
  passate non la sostituiscono. Vedere reports/acceptance.md e reports/performance.md.

<!-- MANUAL ADDITIONS START -->

La Constitution in `.specify/memory/constitution.md` è vincolante. La feature corrente è
`specs/001-core-background-daemon/`; consultare plan.md, data-model.md e contracts prima
di modifiche. Prima piattaforma: macOS 26.3 arm64/APFS; le primitive OS restano dietro porte.
Non eseguire cleanup, implementazione o fasi successive senza la relativa richiesta.
Le soglie della specifica sono target; soltanto i report dei checkpoint attestano le misure effettive. Provider, Agent Runtime,
worktree, gestione dipendenze di progetti ed Electron sono fuori scope della Foundation.

<!-- MANUAL ADDITIONS END -->
