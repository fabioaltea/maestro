# maestro Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-11-17

## Active Technologies

- 004-project-discovery (in implementazione, output/intervista locali UI e headless disponibili; G1 reale aperto): Codex CLI standalone 0.167.0 con login ufficiale Keychain-only; corpus selezionato/sigillato e profilo OS dedicato. Nessun nuovo SDK o pacchetto runtime; G0 sintetico PASS; G1/login reale NOT_RUN. Consultare reports/provider-qualification.md della004.
- Schema 4 implementato sul writer SQLite esistente (metadata e letture Discovery; avvio/output/intervista UI e headless collegati; review/idoneità ancora da completare): ledger/slot/approvazioni Discovery e artefatti privati bounded. Upgrade solo start esplicito; Agent Runtime separato dalla policy Foundation. Consultare specs/004-project-discovery/ e contracts.

- 003-desktop-core-ui (implementato, review umana pendente): Electron 45.3.0, React/react-dom 19.3.1, esbuild 0.28.2 e Playwright 1.65.0; TypeScript 6.0.3. Main Electron Node24 ESM, preload CJS sandboxed e renderer browser; CLI core tramite Node26.13.0 esterno. Pin/compatibilità qualificati con sandbox in G0.
- Ricevute UI private e bounded per query originali dopo crash; nessuna modifica schema3, replica registro o nuovo daemon. Consultare specs/003-desktop-core-ui/{spec,plan,research,data-model,quickstart}.md e contracts prima dell’implementazione desktop.

- TypeScript 6.0.3 strict, Node.js 26.13.0 LTS, ESM/NodeNext; better-sqlite3 13.0.3; API native Node (001-core-background-daemon).
- SQLite locale con WAL e synchronous FULL; lease separati; schema 3 con outbox e journal eventi bounded.
- 002-project-registry (implementato, readiness globale BLOCKED): Git Xcode 2.50.1 (Apple Git-155) verificato tramite xcrun; adapter macOS di ispezione confinata qualificato G1. Schema 3 e upgrade esclusivo implementati nello stesso store. Letture SQLite native in processo transitorio confinato; writer nel worker esistente. Nessuna dipendenza runtime aggiunta.

## Project Structure

```text
src/
tests/
apps/desktop/src/{main,preload,shared,renderer}/
apps/desktop/tests/{unit,contract,integration,e2e}/
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
npm run desktop
npm run typecheck:desktop
npm run build:desktop
npm run test:desktop:unit
npm run test:desktop:integration
npm run test:desktop:e2e
```

## Code Style

TypeScript strict, ESM/NodeNext. Dominio e client non importano adapter OS o driver SQLite.

## Recent Changes

- 004: T001–T027 e T029–T035 completati; Discovery locale UI/headless con output persistente, domande/risposte append-only, continuazione intenzionale e cancel/recovery. Ultime verifiche core mirato204PASS/6SKIP; desktop37unit/29integration/3E2EPASS. G0 precedente8/8PASS; G1 reale NOT_RUN, G2 completo/T036 aperto; documenti/review/idoneità e freshness ancora da completare. Il primo run core sotto carico parallelo ha avuto un errore SIGINT non riprodotto in isolamento e nella selezione finale: consultare reports/validation.md. Scelta utente: Codex CLI con login ufficiale, nessuna API key/fallback automatico. Verifiche mirate, niente nuove campagne di volume/durata.

- 003: prima UI locale sul core001/002; CLI con Node26 esterno, conferme/ricevute, progetti live/offline e attività. G0–G4 qualificati localmente; T054 review umana/picker nativo ancora NOT_RUN. Benchmark eventi di volume/durata rinviati dall’utente2026-11-15; non ricrearli come gate MVP. Gate001/002 invariati. Consultare specs/003-desktop-core-ui/reports/.

- Stato finale 002: 95/96 task completati, T093 aperto/BLOCKED; review T096 conclusa
  con readiness BLOCKED. Non promuovere failure/skip esterni a PASS.

- 002-project-registry: codice delle quattro storie ed E1/E2/E3/V1 qualificati
  localmente. CLI add/list/show/verify/update/remove/operation disponibile; stesso
  daemon, SQLite schema 3, journal/outbox e credenziali Foundation. Nessun provider,
  Discovery, runtime agenti, gestione worktree/dipendenze o Electron aggiunto.
- Verifiche native: 367 test ordinari, 101 contratti e 207 integrazione PASS;
  acceptance completa 53 PASS, 0 FAIL, 1 SKIP reale UID NOT_RUN. 30 SIGKILL distribuiti
  su REGISTER/UPDATE/REMOVE, 100 retry e 20 import concorrenti verificati.
- Misure V1 sul profilo macOS/APFS qualificato: 100 progetti/1000 letture complete/
  10 client, p95 76,14 ms; 30 ispezioni p95 672,87 ms con timeout conservato.
  Due idle separati >=600 s PASS, massimo 78,88 MiB e CPU 0,003333% di un core.
  I target non sono garanzie generali: consultare campioni e limiti nei report.
- T093 resta BLOCKED/aperto: la campagna IP-denied runtime è fallita/interrotta
  perché l’outer sandbox impedisce sandbox annidato e ps; il runner reale
  secondo UID/macchina non è configurato. 001/T082 e 001/T085 non sono derogati.
  Review/documentazione possono concludersi BLOCKED, mai promuovere questi gate a PASS.
- Consultare specs/002-project-registry/plan.md, contracts e reports/acceptance.md,
  reports/performance.md, reports/events.md e reports/release-readiness.md.
  Un commit locale per task; nessun push/pubblicazione implicito.

<!-- MANUAL ADDITIONS START -->

La Constitution in `.specify/memory/constitution.md` è vincolante. La feature corrente è
`specs/001-core-background-daemon/`; consultare plan.md, data-model.md e contracts prima
di modifiche. Prima piattaforma: macOS 26.3 arm64/APFS; le primitive OS restano dietro porte.
Non eseguire cleanup, implementazione o fasi successive senza la relativa richiesta.
Le soglie della specifica sono target; soltanto i report dei checkpoint attestano le misure effettive. Provider, Agent Runtime,
worktree, gestione dipendenze di progetti ed Electron sono fuori scope della Foundation.

<!-- MANUAL ADDITIONS END -->
