# maestro Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-11-18

## Active Technologies

- 004-project-discovery (implementazione locale fino aT054; qualifica reale BLOCKED): Codex CLI standalone 0.167.0 con login ufficiale Keychain-only; corpus selezionato/sigillato e profilo OS dedicato. Nessun nuovo SDK o pacchetto runtime; G0 sintetico PASS; G1/login reale BLOCKED: precheck PROVIDER_UNSAFE, nessuna inferenza. Consultare reports/provider-qualification.md della004.
- Schema 4 implementato sul writer SQLite esistente (metadata e letture Discovery; avvio/output/intervista/review/correzioni/approval/freshness/storico UI e headless collegati): ledger/slot/approvazioni Discovery e artefatti privati bounded. Upgrade solo start esplicito; Agent Runtime separato dalla policy Foundation. Consultare specs/004-project-discovery/ e contracts.

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

- 004: implementazione localeT001–T027/T029–T049/T051–T054; T028/T050 aperti/BLOCKED. G0 sinteticoPASS e G2/G3/G4 fixture localiPASS; core ultimo583test:576PASS/1FAIL/6SKIP (REGISTER isolatoPASS; causa aperta), precedente576PASS/0FAIL/6SKIP; desktop39unit/29integration/34E2EPASS (1SKIP reale separato). Precheck reale autorizzato2026-11-18 con gpt-6.1-sol/pin0.167.0: PROVIDER_UNSAFE prima dell’inferenza; non equivale a login mancante e non è SC-001PASS. Review finale/readinessBLOCKED; nessuna API key/fallback o profilo allentato. Consultare reports/{validation,provider-qualification,release-readiness}.md e real-provider-status.json. Verifiche mirate, niente nuove campagne di volume/durata.

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

## Current implementation

005-feature-planning-implementation completata localmente il 2026-11-19 da base 004 d798a94.
Feature attiva: specs/005-feature-planning/. T001–T036 chiusi, US1–US3 verificati con fixture.
G0 sintetico PASS (12 prove). G1 reale BLOCKED da 004/T028 e T050, capability assistita
indisponibile in produzione. Readiness globale BLOCKED. Consultare reports/validation.md,
reports/qualification.md e reports/release-readiness.md. Constitution e gate001–004 vigenti.
Baseline005: 576PASS/1FAIL/6SKIP, UPDATE replay revision61 vs60; isolatoPASS, causa aperta.
Nessun nuovo pin/package. Un commit per task; preservare apps/desktop/package-lock.json non tracciato.

006-git-workspaces-implementation completata localmente il 2026-11-19 da base005 bfeb84f. Schema6, tre storie su Git Xcode pin, CLI/desktop, refresh, lease interni, cleanup CAS e recovery verificati su fixture. T001–T036 chiusi; 50 PASS core mirati, 48 unit/contract desktop, 13 regressioni desktop e 1 E2E mirato. Worktree e branch conservati negli effetti incerti. Readiness globale BLOCKED per gate001–005. Consultare specs/006-git-workspaces/reports/.

007-workspace-environments-implementation avviata il 2026-11-19 da 006 c536337. Feature attiva: specs/007-workspace-environments/. Consultare plan, data-model, contracts e reports della 007. Schema6 e gate ereditati vigenti. Un commit locale per task; preservare apps/desktop/package-lock.json non tracciato.

008-agent-profiles-implementation completata localmente il 2026-11-20 da 007 0d7f577, tip f5710d2. Schema 8 nel writer esistente. T001–T036 chiusi. Import passivo confinato, profili/skill/tool revisionati, snapshot e accesso headless/desktop verificati. 33 test core, 54 unit/contract Desktop e 3 E2E PASS. Consultare specs/008-agent-profiles/reports/.

009-agent-execution-implementation da 008 f5710d2. Feature attiva specs/009-agent-execution/. Schema 9 e storie parzialmente verificate con fixture. T001–T036 con 26 task chiusi e 10 aperti. G0 Codex app-server sintetico PASS, Claude precheck PROVIDER_UNSAFE, G1 reale NOT_RUN. Avvio reale indisponibile nella composizione standard, readiness BLOCKED. Consultare reports/{validation,qualification,release-readiness}.md. Nessuna deroga ai gate precedenti né pubblicazione. Preservare apps/desktop/package-lock.json non tracciato.

010-session-scheduling-implementation basata su 009 c19db4c. Schema 10, coda/ledger e recovery reservation verificati localmente, 20/36 task. CLI e consultazione Desktop disponibili, executor di fixture. Dispatch produttivo, quote provider e switch end-to-end aperti. Validazione mirata 24 core/58 unit-contract Desktop/1 E2E PASS. Consultare specs/010-session-scheduling/reports/. Gate ereditati vigenti.

011-review-local-merge-implementation basata su 010 0f9a9be. Feature attiva specs/011-review-local-merge/. Schema 11 e 36/36 task completati localmente. Snapshot, check 007, candidate, CAS e recovery Git, ricevuta, freshness Discovery e cleanup 006 verificati su fixture con CLI e Desktop. Build e suite mirate PASS. Readiness di rilascio BLOCKED per gate ereditati. Consultare reports/{validation,qualification,release-readiness}.md. Preservare apps/desktop/package-lock.json non tracciato.
