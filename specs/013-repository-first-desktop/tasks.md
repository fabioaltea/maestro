# Tasks: Un repository alla volta in Maestro

**Input** [Specifica](spec.md) · [Piano](plan.md) · [Ricerca](research.md) · [Contratti](contracts/entrypoints.md)

## Phase 1: Setup

- [x] T001 Verificare fixture, pin e baseline mirata e registrare le condizioni in `specs/013-repository-first-desktop/reports/validation.md`.

## Phase 2: Foundation

- [ ] T002 Definire il binding Desktop del default privato e la consultazione headless in `src/cli/main.ts`, `src/platform/macos/paths.ts` e `apps/desktop/src/main/archive-context.ts`.

## Phase 3: US1 · Aprire o creare un repository (P1)

**Independent Test** Aprire un checkout esistente e inizializzare una cartella vuota da un profilo isolato.

- [ ] T003 [P] [US1] Scrivere prove per bootstrap esplicito, deduplicazione, destinazione vuota, retry e rifiuto su cartella occupata in `tests/integration/repository-entry.test.ts`.
- [ ] T004 [US1] Collegare `project open/create` al lifecycle e al ledger in `src/cli/projects.ts`, `src/client/local-client.ts`, `src/protocol/validation.ts` e `src/core/projects/dispatch.ts`.
- [ ] T005 [US1] Implementare l’effetto Git con intento distinto e probe supervisionato in `src/core/projects/register.ts`, `src/domain/projects/intent.ts` e `src/platform/macos/git/probe-main.ts`.
- [ ] T006 [US1] Collegare picker, conferma di creazione, aperture e stato iniziale in `apps/desktop/src/main/project-actions.ts`, `apps/desktop/src/renderer/App.tsx` e `apps/desktop/src/renderer/views/Projects.tsx`. Aggiornare il bridge e aggiungere E2E in `apps/desktop/tests/e2e/repository-entry.spec.ts`.

## Phase 4: US2 · Analizzare e creare una feature (P1)

**Independent Test** Aprire Discovery del progetto, approvare la fixture e raggiungere la nuova feature dello stesso progetto. Provare il blocco senza approvazione corrente.

- [ ] T007 [US2] Definire le prove di eleggibilità, percorso e blocco in `apps/desktop/tests/e2e/repository-entry.spec.ts` usando le fixture 004 e 005.
- [ ] T008 [US2] Collegare «Analizza codebase», stato Discovery, aggiornamento dopo approvazione e «Nuova feature» in `apps/desktop/src/renderer/views/{ProjectDetail,Discovery,FeaturePlanning}.tsx`, mantenendo consenso e gate correnti.

## Phase 5: US3 · Riaprire e recuperare (P2)

**Independent Test** Alternare due repository, rileggere lo storico dopo riavvio e recuperare uno store precedente compatibile con fonte preservata.

- [ ] T009 [P] [US3] Scrivere prove di isolamento progetto, risposta tardiva, riapertura e recupero in `tests/integration/archive-adoption.test.ts` e `apps/desktop/tests/contract/repository-scope.test.ts`.
- [ ] T010 [US3] Collegare recenti, viste del progetto, ricevute originali e scope delle conferme in `apps/desktop/src/main/{archive-context,action-handlers,lifecycle}.ts` e `apps/desktop/src/renderer/{App.tsx,views/}`.
- [ ] T011 [US3] Implementare il recupero verificato del default vuoto con CLI e Diagnostica in `src/cli/archive.ts`, `src/platform/macos/paths.ts` e `apps/desktop/src/renderer/views/Diagnostics.tsx`.
- [ ] T012 [US3] Adattare fixture Desktop e prove pregresse alla selezione del progetto e coprire la riapertura in `apps/desktop/tests/fixtures/electron.ts` e `apps/desktop/tests/e2e/`.

## Phase 6: Verifica finale

- [ ] T013 Eseguire build, typecheck, lint, suite mirate e checkpoint SC-001–004. Registrare esiti e limiti in `specs/013-repository-first-desktop/reports/validation.md`.
- [ ] T014 Concludere review locale, registrare SC-005 e review umana come verificati o pendenti secondo evidenza e riportare gate ereditati in `specs/013-repository-first-desktop/reports/readiness.md`.

## Dependencies & Execution Order

T001 → T002 → US1. US2 riusa la vista di un progetto registrato. US3 riusa le identità e il campionamento di US1. I test etichettati [P] operano su file distinti come unità di lavoro indipendenti. Per US1 il test core T003 può essere preparato separatamente dal test E2E. Per US2 il caso approvato e quello obsoleto usano fixture distinte. Per US3 i test di adozione headless e di scope Desktop sono indipendenti tra loro. T013–T014 consolidano le prove disponibili.

## Implementation Strategy

MVP US1. Aggiungere la continuità Discovery → feature con US2. Completare recenti, isolamento e recupero con US3. Il rilascio richiede le prove di qualifica previste. Copertura FR e SC mappata dalle prove di storia e dai checkpoint finali.
