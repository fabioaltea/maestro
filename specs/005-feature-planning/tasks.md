# Tasks: Feature Planning & Versioned Approval

**Input**: [spec.md](spec.md), [plan.md](plan.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/api.md](contracts/api.md), [contracts/policy.md](contracts/policy.md), [quickstart.md](quickstart.md).
**Branch**: `005-feature-planning` · **Date**: 2026-11-19 · **Stato**: implementazione autorizzata2026-11-19; avanzamento nelle checkbox e in reports/validation.md.

**Tests**: richiesti esplicitamente dalla specifica per invarianti costituzionali. Scrivere i casi prima dell’implementazione pertinente; provider/clock/risorse sostituibili, integrazioni locali senza account. Ogni task concluso richiede un commit locale con ID ed evidenza; nessun push implicito.

**Paths**: relativi a `/Users/fabioaltea/Repository/maestro/`; file nuovi proposti dove assenti. [P] indica file indipendenti dopo i prerequisiti del blocco, non parallelo su writer/protocollo/bridge condivisi.

## Phase 1: Setup & G0

- [X] T001 Registrare baseline, gate001–004 aperti e dipendenze di schema4 in `specs/005-feature-planning/reports/validation.md`; preservare modifiche utente e fissare l’ambito del gate senza eseguire campagne lunghe.
- [X] T002 Scrivere prove negative di capability/confine in `tests/integration/feature-boundary.test.ts` e fixture in `tests/fixtures/feature-boundary.ts`: G0: test di confine readonly e schema FeaturePlanningResult con provider sintetico. G1 assistito reale solo dopo004/T028/T050; registrare NOT_RUN/BLOCKED senza impedire la verifica del percorso manuale con fixture. Nessun consenso reale assunto.
- [X] T003 Implementare la primitiva reale minima di confine in `src/providers/codex/feature-planning-parser.ts` e la porta in `src/ports/feature.ts`, con fixture `tests/fixtures/feature-adapter.ts`; validare su questa primitiva i confini indicati in `specs/005-feature-planning/contracts/api.md`; usare solo API/pin supportati e non pubblicare capability prima della composizione.
- [X] T004 Eseguire G0 locale sintetico e registrare pin/hash/config, prove negative, limiti e stato in `specs/005-feature-planning/reports/qualification.md`; capability non dimostrata resta BLOCKED/UNSUPPORTED, qualifica reale distinta e nessun allentamento per superare il gate.

**Checkpoint**: G0 di authoring/input locale abilita US1/US2 senza provider; il ramo G0 assistito abilita solo US3. Un blocco sul provider non impedisce il lavoro manuale con Discovery corrente. Nessuno dei due certifica autenticazione/provider reale.

## Phase 2: Foundational (Blocking Prerequisites)

- [X] T005 [P] Scrivere unit test di transizioni, scope/versioni dei grant e generazioni in `tests/unit/feature-state.test.ts`; coprire invalidazione, terminali, retry e limiti numerici con tempo controllato (FR-011/012).
- [X] T006 [P] Scrivere integrazione schema4→5, letture storiche immutabili, crash pre/post commit e ledger UUID cross-namespace in entrambi i versi in `tests/integration/feature-schema.test.ts` (FR-011).
- [X] T007 Implementare `src/storage/features-schema.ts`, `src/storage/features-upgrade.ts`, `src/storage/features-store.ts` e collegamenti in `src/storage/worker.ts`/`src/storage/readonly-database.ts`: schema5 solo start, version-check storici, integrity/FK, CAS e outbox atomica. Aggiornare reader/driver/upgrade chain esistenti secondo i contratti trasversali, senza alterare SQL storici congelati.
- [X] T008 Implementare ledger/grant/artefatti comuni in `src/domain/workflow/operation.ts`, `src/domain/workflow/authorization.ts`, `src/ports/workflow.ts`, `src/storage/workflow-schema.ts`, `src/storage/workflow-store.ts`, `src/storage/workflow-artifacts.ts`: UUID esclusivo contro request_catalog/Discovery in entrambi i versi, grant monouso, quota128MiB/8192oggetti con8MiB di riserva, seal/fsync/hash e nessuna eviction irrisolta; coprire fault/saturazione in `tests/integration/workflow-store.test.ts`.
- [X] T009 [P] Scrivere contract API/CLI e reader offline in `tests/contract/feature-api.test.ts` e `tests/integration/feature-offline.test.ts`: DTO chiusi, envelope32KiB/chunk8KiB, cursori, offline immutabile e nessun effetto da lettura (FR-010/012).
- [X] T010 Implementare DTO/validazione in `src/protocol/feature.ts`, dispatcher/read in `src/core/features/dispatch.ts` e `src/core/features/read.ts`, collegando `src/protocol/messages.ts`, `src/protocol/validation.ts`, `src/client/local-client.ts` e allowlist del reader confinato. Capability version1 solo per metodi composti.
- [X] T011 Comporre admission/authorization/recovery con i servizi comuni in `src/core/features/runtime.ts` e `src/core/runtime.ts`; introdurre src/core/workflow/{admission,authorization,recovery}.ts e coordinare drain, intent e risultati generazione-bound, estendendo `scripts/check-architecture.mjs` ai nuovi confini e `scripts/build-assets.mjs` solo se ci sono asset trusted.
- [X] T012 Collegare eventi metadata e budget in `src/protocol/events.ts` e `src/protocol/feature-events.ts`; provare correlazioni, segreti assenti, backpressure, quota piena con query/cancel/recovery possibili in `tests/integration/feature-limits.test.ts` (FR-010/011/012).

**Checkpoint**: schema/store/contract/ownership testati senza UI o rete. T007→T008→T010→T011→T012 sequenziali; test T005/T006/T009 preparabili insieme dopo G0. Nessuna storia prima delle fondazioni; per US1/US2 il gate di ingresso è quello locale di authoring, non la qualifica provider di US3.

## Phase 3: User Story 1 — Creare e correggere una feature (Priority: P1)

**Goal**: Descrivere una richiesta, compilare specifica e piano e conservare revisioni senza eseguire codice.

**Independent Test**: Con progetto fixture approvato creare una feature manuale, revisionarla e rileggerla dopo restart; senza approvazione valida non compare alcuna nuova feature.

**Coverage**: FR-001–FR-003; FR-010/011/012 trasversali.

- [X] T013 [P] [US1] Scrivere policy/transizioni US1 in `tests/unit/feature-us1.test.ts`: Creation senza Discovery, race freshness, revisione concorrente, corpi grandi sigillati, rimozione progetto e retry dopo risposta persa; testare grant/revisioni e comportamento sicuro (FR-001–FR-003).
- [X] T014 [P] [US1] Scrivere contract US1 in `tests/contract/feature-us1.test.ts`: metodi della storia in `specs/005-feature-planning/contracts/api.md`, capability assente, input invalidi e azione/grant di altro ambito rifiutati (FR-001–FR-003, FR-011).
- [X] T015 [P] [US1] Scrivere integrazione locale US1 in `tests/integration/feature-us1.test.ts` con fixture di repository/processi/clock pertinenti: Con progetto fixture approvato creare una feature manuale, revisionarla e rileggerla dopo restart; senza approvazione valida non compare alcuna nuova feature. Includere crash pre/post effetto, retry e operazioni concorrenti, nessun servizio esterno (FR-001–FR-003, FR-011/012).
- [X] T016 [US1] Implementare tipi/invarianti della storia in `src/domain/features/model.ts` e aggiornare `src/ports/feature.ts` con riferimenti neutri, revisioni e prove richieste, senza OS/SQLite nel dominio (FR-001–FR-003).
- [X] T017 [US1] Implementare servizio in `src/core/features/authoring.ts`: Implementare create/revise/archive con observation readonly, CAS, ledger comune e pubblicazione artefatti prima del riferimento; archive rifiuta risorse attive. Test precedenti devono passare, esito incerto resta interrogabile (FR-001–FR-003).
- [ ] T018 [US1] Collegare i metodi US1 a `src/core/features/dispatch.ts`, `src/cli/feature.ts`, `src/cli/main.ts` e `src/client/local-client.ts`: prepare/confirm, UUID originale, pagine e nessun testo/credenziale in argv; verificare parity con `tests/contract/feature-us1.test.ts` (FR-001–FR-003, FR-010).
- [ ] T019 [US1] Esporre US1 in `apps/desktop/src/main/feature.ts`, `apps/desktop/src/shared/feature-contract.ts`, `apps/desktop/src/preload/index.cts`, `apps/desktop/src/renderer/views/FeaturePlanning.tsx` e navigazione in `apps/desktop/src/renderer/App.tsx`; aggiungere contract `apps/desktop/tests/contract/feature-us1.test.ts` ed E2E `apps/desktop/tests/e2e/feature-flow.spec.ts` con ricevuta/confirm, offline, focus, archivi e risposte tardive (FR-010/011/012).

**Checkpoint US1**: scenario indipendente ripetibile con fixture dopo le fasi precedenti; nessun gate reale derivato dal solo test simulato.

## Phase 4: User Story 2 — Approvare un piano e preparare l’implementazione (Priority: P1)

**Goal**: Approvare una precisa revisione e produrre un handoff che i moduli successivi possano rivalidare.

**Independent Test**: Approvare un bundle fixture, ottenere envelope, mutare contesto o piano e verificare che ogni handoff successivo sia rifiutato mentre la decisione storica resta leggibile.

**Coverage**: FR-004–FR-006; FR-010/011/012 trasversali.

- [ ] T020 [P] [US2] Scrivere policy/transizioni US2 in `tests/unit/feature-us2.test.ts`: Approval assente/stale, contesto cambiato tra prepare e consumo, progetto reimportato e collisione UUID cross namespace; testare grant/revisioni e comportamento sicuro (FR-004–FR-006).
- [ ] T021 [P] [US2] Scrivere contract US2 in `tests/contract/feature-us2.test.ts`: metodi della storia in `specs/005-feature-planning/contracts/api.md`, capability assente, input invalidi e azione/grant di altro ambito rifiutati (FR-004–FR-006, FR-011).
- [ ] T022 [P] [US2] Scrivere integrazione locale US2 in `tests/integration/feature-us2.test.ts` con fixture di repository/processi/clock pertinenti: Approvare un bundle fixture, ottenere envelope, mutare contesto o piano e verificare che ogni handoff successivo sia rifiutato mentre la decisione storica resta leggibile. Includere crash pre/post effetto, retry e operazioni concorrenti, nessun servizio esterno (FR-004–FR-006, FR-011/012).
- [ ] T023 [US2] Implementare tipi/invarianti della storia in `src/domain/features/approval.ts` e aggiornare `src/ports/feature.ts` con riferimenti neutri, revisioni e prove richieste, senza OS/SQLite nel dominio (FR-004–FR-006).
- [ ] T024 [US2] Implementare servizio in `src/core/features/approval.ts`: Implementare approve/handoff con rivalidazione fresh e CAS; esporre envelope immutabile senza acquisire permessi runtime o effettuare spawn. Test precedenti devono passare, esito incerto resta interrogabile (FR-004–FR-006).
- [ ] T025 [US2] Collegare i metodi US2 a `src/core/features/dispatch.ts`, `src/cli/feature.ts`, `src/cli/main.ts` e `src/client/local-client.ts`: prepare/confirm, UUID originale, pagine e nessun testo/credenziale in argv; verificare parity con `tests/contract/feature-us2.test.ts` (FR-004–FR-006, FR-010).
- [ ] T026 [US2] Esporre US2 in `apps/desktop/src/main/feature.ts`, `apps/desktop/src/shared/feature-contract.ts`, `apps/desktop/src/preload/index.cts`, `apps/desktop/src/renderer/views/FeaturePlanning.tsx` e navigazione in `apps/desktop/src/renderer/App.tsx`; aggiungere contract `apps/desktop/tests/contract/feature-us2.test.ts` ed E2E `apps/desktop/tests/e2e/feature-flow.spec.ts` con ricevuta/confirm, offline, focus, archivi e risposte tardive (FR-010/011/012).

**Checkpoint US2**: scenario indipendente ripetibile con fixture dopo le fasi precedenti; nessun gate reale derivato dal solo test simulato.

## Phase 5: User Story 3 — Ottenere una bozza assistita e rispondere alle domande (Priority: P2)

**Goal**: Richiedere analisi readonly e rispondere a domande mantenendo le assunzioni visibili.

**Independent Test**: Provider simulato produce una domanda e una bozza; due turni espliciti conservano risposte/provenance; provider indisponibile lascia utilizzabile il documento manuale.

**Coverage**: FR-007–FR-009; FR-010/011/012 trasversali.

- [ ] T027 [P] [US3] Scrivere policy/transizioni US3 in `tests/unit/feature-us3.test.ts`: Schema/provenance invalida, consenso stale, provider unsafe/auth/quota, timeout/cancel e late result di generazione precedente; testare grant/revisioni e comportamento sicuro (FR-007–FR-009).
- [ ] T028 [P] [US3] Scrivere contract US3 in `tests/contract/feature-us3.test.ts`: metodi della storia in `specs/005-feature-planning/contracts/api.md`, capability assente, input invalidi e azione/grant di altro ambito rifiutati (FR-007–FR-009, FR-011).
- [ ] T029 [P] [US3] Scrivere integrazione locale US3 in `tests/integration/feature-us3.test.ts` con fixture di repository/processi/clock pertinenti: Provider simulato produce una domanda e una bozza; due turni espliciti conservano risposte/provenance; provider indisponibile lascia utilizzabile il documento manuale. Includere crash pre/post effetto, retry e operazioni concorrenti, nessun servizio esterno (FR-007–FR-009, FR-011/012).
- [ ] T030 [US3] Implementare tipi/invarianti della storia in `src/domain/features/planning.ts` e aggiornare `src/ports/feature.ts` con riferimenti neutri, revisioni e prove richieste, senza OS/SQLite nel dominio (FR-007–FR-009).
- [ ] T031 [US3] Implementare servizio in `src/core/features/planning.ts`: Aggiungere src/ports/feature-planning.ts e decoder risultato separato in src/providers/codex/feature-planning.ts; comporre runtime readonly solo se qualificato, fencing generation e cancel con prova di uscita. Test precedenti devono passare, esito incerto resta interrogabile (FR-007–FR-009).
- [ ] T032 [US3] Collegare i metodi US3 a `src/core/features/dispatch.ts`, `src/cli/feature.ts`, `src/cli/main.ts` e `src/client/local-client.ts`: prepare/confirm, UUID originale, pagine e nessun testo/credenziale in argv; verificare parity con `tests/contract/feature-us3.test.ts` (FR-007–FR-009, FR-010).
- [ ] T033 [US3] Esporre US3 in `apps/desktop/src/main/feature.ts`, `apps/desktop/src/shared/feature-contract.ts`, `apps/desktop/src/preload/index.cts`, `apps/desktop/src/renderer/views/FeaturePlanning.tsx` e navigazione in `apps/desktop/src/renderer/App.tsx`; aggiungere contract `apps/desktop/tests/contract/feature-us3.test.ts` ed E2E `apps/desktop/tests/e2e/feature-flow.spec.ts` con ricevuta/confirm, offline, focus, archivi e risposte tardive (FR-010/011/012).

**Checkpoint US3**: scenario indipendente ripetibile con fixture dopo le fasi precedenti; nessun gate reale derivato dal solo test simulato.

## Phase 6: Polish & Cross-Cutting Review

- [ ] T034 Eseguire build/typecheck/lint e suite mirate core/desktop per i file modificati, aggiornando `specs/005-feature-planning/reports/validation.md` con matrice FR/SC, comandi/esiti e limiti; non rilanciare acceptance/bench lunghi né promuovere skip a PASS.
- [ ] T035 Verificare le tre storie di `specs/005-feature-planning/quickstart.md` e i cap del piano; registrare in `specs/005-feature-planning/reports/qualification.md` prove reali solo se autorizzate e capability effettive, altrimenti NOT_RUN/BLOCKED. Preservare separati gli esiti fixture, provider/login/hosting reali e review umana.
- [ ] T036 Concludere review degli otto principi, permessi e gate precedenti in `specs/005-feature-planning/reports/release-readiness.md`, aggiornando `specs/005-feature-planning/tasks.md` solo per lavoro provato; annotare dipendenze ancora bloccate e nessuna integrazione/pubblicazione implicita.

## Dependencies & Execution Order

- Dipendenze feature: 004 per projectId, documento approvato ed eligibility attuale. Il percorso reale dipende dalla chiusura del blocco provider004; fixture approvate servono solo nei test. Non dipende009.
- Schema cumulativo: 4→5; non saltare pacchetti precedenti anche se un servizio è funzionalmente indipendente.
- T001→T002→T003→T004, quindi Phase2; test prima dell’implementazione pertinente. G0 fallito blocca solo la capability dipendente e la relativa qualifica, senza promuovere lo stato.
- US1→US2→US3 nell’ordine del workflow condiviso; le prove di US2/US3 usano fixture dei risultati precedenti e non richiedono un provider reale. Indipendenza significa testabile, non assenza di prerequisiti di dominio.
- Mutazioni su store/protocol/CLI/bridge/view condivisi sono sequenziali. I tre test di ogni storia marcati [P] hanno file distinti e possono essere scritti in parallelo dopo le fondazioni.
- Review finale dopo le tre storie; un esito BLOCKED è ammesso nel report ma non dichiara completata la capability.

## Parallel Examples per User Story

- US1: preparare insieme `tests/unit/feature-us1.test.ts`, `tests/contract/feature-us1.test.ts`, `tests/integration/feature-us1.test.ts`; poi eseguire sequenzialmente dominio→servizio→CLI→desktop (T013–T019).
- US2: preparare insieme `tests/unit/feature-us2.test.ts`, `tests/contract/feature-us2.test.ts`, `tests/integration/feature-us2.test.ts`; poi eseguire sequenzialmente dominio→servizio→CLI→desktop (T020–T026).
- US3: preparare insieme `tests/unit/feature-us3.test.ts`, `tests/contract/feature-us3.test.ts`, `tests/integration/feature-us3.test.ts`; poi eseguire sequenzialmente dominio→servizio→CLI→desktop (T027–T033).

## Traceability & Independent Criteria

| Storia | Requisiti | Task | Criterio indipendente |
|---|---|---|---|
| US1 | FR-001–FR-003 | T013–T019 | Con progetto fixture approvato creare una feature manuale, revisionarla e rileggerla dopo restart; senza approvazione valida non compare alcuna nuova feature. |
| US2 | FR-004–FR-006 | T020–T026 | Approvare un bundle fixture, ottenere envelope, mutare contesto o piano e verificare che ogni handoff successivo sia rifiutato mentre la decisione storica resta leggibile. |
| US3 | FR-007–FR-009 | T027–T033 | Provider simulato produce una domanda e una bozza; due turni espliciti conservano risposte/provenance; provider indisponibile lascia utilizzabile il documento manuale. |

FR-010/011/012: T005–T012, i tre test e integrazioni CLI/desktop di ogni storia; SC-001–SC-004 validati nei relativi scenari e consolidati T034–T035. I/II→offline/client;III→adapter/capability;IV→precondizioni;V→crash/idempotenza;VI→grant;VII→test prima del codice;VIII→output/quote: tutti nelle fasi pertinenti, non rinviati al polish.

## Implementation Strategy

1. G0 e fondazioni.
2. MVP = US1: Con progetto fixture approvato creare una feature manuale, revisionarla e rileggerla dopo restart; senza approvazione valida non compare alcuna nuova feature. Fermarsi al checkpoint per misurare il risultato e registrare limiti.
3. Aggiungere US2 e US3 con test indipendenti e nuova review delle autorizzazioni; il primo slice non certifica l’intero ciclo Maestro.
4. Eseguire verifiche mirate e review finale; un commit locale per task, nessun push/pubblicazione implicito.

**Format validation**: 36 task sequenziali T001–T036; 7 per storia,12 setup/foundation,3 finali. Tutti hanno checkbox, ID e percorsi; [USn] solo nelle fasi di storia, [P] solo test su file distinti. Nessun task eseguito durante la generazione.

## Complessità, rischi e accettazione per task

Complessità relativa: S=contenuta, M=media, L=alta; non è una stima di ore. Ogni task è coperto da una riga: dipendenze esplicite sopra, rischio e prova richiesta sotto.

| Task | Complessità | Rischio principale | Criterio di completamento / prova |
|---|---|---|---|
| T001 | S | Baseline o debiti omessi | Report cita stato e gate reali senza promozioni |
| T002–T004 | L | Confine/capability non dimostrati | Prova negativa su primitiva reale e report pin/policy; nessun effetto vietato |
| T005–T006 | M | Stato/grant o upgrade incoerenti | Casi negativi e crash inizialmente fallenti descritti e ripetibili |
| T007–T008 | L | Perdita dati/idempotenza/quote | Test schema/store PASS, storico e UUID globali preservati |
| T009–T010 | M | DTO/reader/dispatch permissivi | Contract PASS e letture offline immutate |
| T011–T012 | L | Owner/drain/output e budget | Test limiti/recovery PASS, capability solo realmente composta |
| T013–T015,T020–T022,T027–T029 | M | Scenario negativo non protetto | Unit/contract/integrazione coprono i requisiti della storia senza credenziali |
| T016,T023,T030 | M | Invariante o stato implicito | Test di policy/transizioni della storia PASS |
| T017,T024,T031 | L | Effetto esterno o risultato stale | Scenario indipendente e fault della storia PASS, ownership/approval preservati |
| T018,T025,T032 | M | Duplicazione o grant aggirato dal client | Parità CLI/API e query UUID originale PASS |
| T019,T026,T033 | M | UI concede scope o perde esito | Contract/E2E, tastiera/focus e ricevuta originali PASS |
| T034 | M | Regressioni non riportate | Verifiche pertinenti con esiti grezzi/documentati |
| T035 | M | Fixture spacciata per qualifica reale | Quickstart ripetibile; esiti G0/G1 e limiti separati |
| T036 | M | Readiness dichiarata senza prove | Review otto principi e gate aperti, nessuna release implicita |
