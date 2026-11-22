# Tasks: Storico Git ed esploratore di `main`

**Input**: [specifica](./spec.md), [piano](./plan.md), [ricerca](./research.md), [modello dati](./data-model.md), [contratto](./contracts/repository-read.md) e [quickstart](./quickstart.md).
I percorsi nei task sono relativi alla radice. Scrivere i test di ciascuna storia prima della relativa implementazione.

## Phase 1: Setup

- [X] T001 Preparare le fixture Git riusabili (merge, tag, worktree esterno e detached, `main` divergente dal checkout, snapshot pre/post) in `tests/integration/helpers/repository-read-fixture.ts`.

## Phase 2: Foundational

- [X] T002 Aggiungere in `tests/contract/repository-read-context.test.ts` e `apps/desktop/tests/contract/repository-read-context.test.ts` i test per identità cambiata, progetto non disponibile, cambi di contesto, scadenza, cancellazione e risposte fuori limite.
- [X] T003 Estrarre e riusare la verifica delle ancore in `src/platform/macos/git/repository-identity-check.ts` e `src/platform/macos/git/repository-documents.ts`; preservare nel runner `src/platform/macos/git/runner.ts` confinamento, assenza di rete/scritture, deadline e classificazione esplicita degli errori.
- [X] T004 Preparare il dispatch di sola lettura e il contesto progetto/revisione in `src/core/inspect-main.ts` e `src/cli/projects.ts`; gestire handle, generazioni, paginazione e log correlati senza contenuto in `apps/desktop/src/main/repository-read-context.ts`. Non introdurre persistenza.

## Phase 3: US1 — Storico Git e worktree (P1, MVP)

**Test indipendente**: Aprire solo Storico Git; navigare oltre la prima pagina, seguire un worktree detached e leggere i file di un merge.

- [X] T005 [P] [US1] Coprire i tre contratti dello storico, appartenenza del commit, limiti e handle/cursori invalidi in `tests/contract/repository-history.test.ts`.
- [ ] T006 [P] [US1] Testare grafo e genitori, REF/tag, worktree esterni/bloccati/non verificabili, refresh durante cambi concorrenti, repo vuoto e invarianza Git offline/nei retry in `tests/integration/repository-history.test.ts`.
- [ ] T007 [P] [US1] Scrivere in `apps/desktop/tests/e2e/repository-history.spec.ts` il flusso di navigazione, dettaglio merge, salto al commit detached e scarto di una risposta tardiva dopo il cambio repository.
- [X] T008 [US1] Implementare inventario, grafo paginato su radici fissate e dettaglio sul primo genitore in `src/platform/macos/git/repository-history.ts` e `src/platform/macos/git/runner.ts`. Collegare le query in `src/core/inspect-main.ts` e `src/cli/projects.ts`.
- [X] T009 [US1] Esporre e validare le tre letture dello storico in `apps/desktop/src/shared/repository-history-contract.ts`, `apps/desktop/src/shared/bridge-contract.ts`, `apps/desktop/src/shared/validation.ts`, `apps/desktop/src/main/core-cli.ts`, `apps/desktop/src/main/read-handlers.ts` e `apps/desktop/src/preload/index.cts`.
- [X] T010 [US1] Implementare grafo navigabile da tastiera, inventario e dettaglio, caricamenti ed errori in `apps/desktop/src/renderer/views/RepositoryHistory.tsx`; collegare route e stili in `apps/desktop/src/renderer/App.tsx`, `apps/desktop/src/renderer/components/RepositoryNavigation.tsx` e `apps/desktop/src/renderer/styles.css`.

## Phase 4: US2 — Esploratore di `main` (P2)

**Test indipendente**: Aprire solo Codice con checkout sporco su un altro branch; aprire due schede, avanzare `main` e verificare che solo il refresh cambi l'OID mostrato.

- [X] T011 [P] [US2] Coprire i tre contratti di Codice con `main` assente, handle/cursori errati, path fuori albero, confini di dimensione e testo non supportato in `tests/contract/repository-code.test.ts`.
- [X] T012 [P] [US2] Testare albero grande, percorsi letterali, checkout sporco, `main` mobile, link/gitlink, binario, 1 MiB, letture concorrenti/annullate, retry e invarianza Git in `tests/integration/repository-code.test.ts`.
- [ ] T013 [P] [US2] Scrivere in `apps/desktop/tests/e2e/repository-code.spec.ts` il flusso albero/schede/ricerca, refresh atomico, cambio repository durante una lettura e retry senza rete o daemon.
- [X] T014 [US2] Implementare apertura sul `main` esatto, albero paginato e lettura bounded di blob normali in `src/platform/macos/git/repository-code.ts` e `src/platform/macos/git/runner.ts`. Collegare le query in `src/core/inspect-main.ts` e `src/cli/projects.ts`.
- [X] T015 [US2] Esporre le letture, validare e ricomporre i chunk senza cache persistente in `apps/desktop/src/shared/repository-code-contract.ts`, `apps/desktop/src/shared/bridge-contract.ts`, `apps/desktop/src/shared/validation.ts`, `apps/desktop/src/main/core-cli.ts`, `apps/desktop/src/main/read-handlers.ts` e `apps/desktop/src/preload/index.cts`.
- [X] T016 [US2] Dichiarare i parser Lezer a bundle locale in `package.json`, aggiornare `package-lock.json` con npm e mantenere l'allowlist del renderer in `scripts/check-architecture.mjs`; non includere il lockfile Desktop già non tracciato.
- [X] T017 [US2] Implementare albero, schede, refresh esplicito e visualizzatore read-only con righe e ricerca in `apps/desktop/src/renderer/views/RepositoryCode.tsx`; collegare route e stili in `apps/desktop/src/renderer/App.tsx`, `apps/desktop/src/renderer/components/RepositoryNavigation.tsx` e `apps/desktop/src/renderer/styles.css`.

## Phase 5: Polish & Cross-Cutting Concerns

- [ ] T018 Eseguire typecheck, build e suite mirate dei test sopra; confrontare le regressioni Desktop note col baseline e registrare SC-001–004, inclusa l'eventuale prova utenti non eseguita, in `specs/014-repository-history-code/quickstart.md`.

## Dependencies & Execution Order

- Setup T001 → Fondazione T002–T004 → storie US1 / US2 → T018. Le storie sono funzionalmente indipendenti; per evitare conflitti, serializzare le modifiche a runner, CLI, bridge e route condivisi.
- **Parallel US1**: T005, T006 e T007 usano file distinti; poi T008 → T009 → T010.
- **Parallel US2**: T011, T012 e T013 usano file distinti, anche durante l'MVP; poi T014 → T015 → T016 → T017.
- **Copertura**: FR-002–004 in T005–T010; FR-005–007 in T011–T017; FR-001, FR-008 e FR-009 in entrambe le storie e in T002–T004. I test di confinamento, interruzione e preservazione Git precedono la consegna delle singole storie.

## Implementation Strategy

Consegnare prima **Storico Git**; fermarsi al suo test indipendente per il checkpoint MVP. Aggiungere **Codice** senza cambiare il comportamento dello storico, quindi verificare entrambe le viste.
