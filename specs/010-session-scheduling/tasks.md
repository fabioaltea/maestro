# Tasks: Session Scheduling, Quotas & Provider Policies

**Input**: [spec.md](spec.md), [plan.md](plan.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/api.md](contracts/api.md), [contracts/policy.md](contracts/policy.md), [quickstart.md](quickstart.md).
**Branch**: `010-session-scheduling` · **Date**: 2026-11-19 · **Stato**: 0 task eseguiti, implementazione non autorizzata da questo documento.

**Tests**: richiesti esplicitamente dalla specifica per invarianti costituzionali. Scrivere i casi prima dell’implementazione pertinente; provider/clock/risorse sostituibili, integrazioni locali senza account. Ogni task concluso richiede un commit locale con ID ed evidenza; nessun push implicito.

**Paths**: relativi a `/Users/fabioaltea/Repository/maestro/`; file nuovi proposti dove assenti. [P] indica file indipendenti dopo i prerequisiti del blocco, non parallelo su writer/protocollo/bridge condivisi.

## Phase 1: Setup & G0

- [x] T001 Registrare baseline, gate001–004 aperti e dipendenze di schema9 in `specs/010-session-scheduling/reports/validation.md`; preservare modifiche utente e fissare l’ambito del gate senza eseguire campagne lunghe.
- [x] T002 Scrivere prove negative di capability/confine in `tests/integration/scheduler-boundary.test.ts` e fixture in `tests/fixtures/scheduler-boundary.ts`: Fixture clock/provider e processi locali brevi; almeno due progetti e quattro job, fault per reservation/spawn/release. Nessuna prova600s, volume1000 o consumo reale necessario al gate locale. Nessun consenso reale assunto.
- [x] T003 Implementare la primitiva reale minima di confine in `src/domain/scheduler/resource-admission.ts` e la porta in `src/ports/scheduler.ts`, con fixture `tests/fixtures/scheduler-adapter.ts`; validare su questa primitiva i confini indicati in `specs/010-session-scheduling/contracts/api.md`; usare solo API/pin supportati e non pubblicare capability prima della composizione.
- [x] T004 Eseguire G0 locale sintetico e registrare pin/hash/config, prove negative, limiti e stato in `specs/010-session-scheduling/reports/qualification.md`; capability non dimostrata resta BLOCKED/UNSUPPORTED, qualifica reale distinta e nessun allentamento per superare il gate.

**Checkpoint**: G0 locale necessario alle capacità dipendenti; non certifica autenticazione/provider/remoti reali.

## Phase 2: Foundational (Blocking Prerequisites)

- [x] T005 [P] Scrivere unit test di transizioni, scope/versioni dei grant e generazioni in `tests/unit/scheduler-state.test.ts`; coprire invalidazione, terminali, retry e limiti numerici con tempo controllato (FR-011/012).
- [x] T006 [P] Scrivere integrazione schema9→10, letture storiche immutabili, crash pre/post commit e ledger UUID cross-namespace in entrambi i versi in `tests/integration/scheduler-schema.test.ts` (FR-011).
- [x] T007 Implementare `src/storage/scheduler-schema.ts`, `src/storage/scheduler-upgrade.ts`, `src/storage/scheduler-store.ts` e collegamenti in `src/storage/worker.ts`/`src/storage/readonly-database.ts`: schema10 solo start, version-check storici, integrity/FK, CAS e outbox atomica. Aggiornare reader/driver/upgrade chain esistenti secondo i contratti trasversali, senza alterare SQL storici congelati.
- [x] T008 Collegare namespace e reservation del modulo in `src/storage/scheduler-store.ts` e `src/ports/workflow.ts`; estendere collision guard dei ledger Foundation/Registry/Discovery/workflow in `src/storage/workflow-store.ts`, senza secondo writer, e coprire artefatto mancante/quote/reply loss in `tests/integration/scheduler-store.test.ts`.
- [x] T009 [P] Scrivere contract API/CLI e reader offline in `tests/contract/scheduler-api.test.ts` e `tests/integration/scheduler-offline.test.ts`: DTO chiusi, envelope32KiB/chunk8KiB, cursori, offline immutabile e nessun effetto da lettura (FR-010/012).
- [x] T010 Implementare DTO/validazione in `src/protocol/scheduler.ts`, dispatcher/read in `src/core/scheduler/dispatch.ts` e `src/core/scheduler/read.ts`, collegando `src/protocol/messages.ts`, `src/protocol/validation.ts`, `src/client/local-client.ts` e allowlist del reader confinato. Capability version1 solo per metodi composti.
- [x] T011 Comporre admission/authorization/recovery con i servizi comuni in `src/core/scheduler/runtime.ts` e `src/core/runtime.ts`; coordinare drain, intent e risultati generazione-bound, estendendo `scripts/check-architecture.mjs` ai nuovi confini e `scripts/build-assets.mjs` solo se ci sono asset trusted.
- [x] T012 Collegare eventi metadata e budget in `src/protocol/events.ts` e `src/core/scheduler/events.ts`; provare correlazioni, segreti assenti, backpressure, quota piena con query/cancel/recovery possibili in `tests/integration/scheduler-limits.test.ts` (FR-010/011/012).

**Checkpoint**: schema/store/contract/ownership testati senza UI o rete. T007→T008→T010→T011→T012 sequenziali; test T005/T006/T009 preparabili insieme dopo G0. Nessuna storia prima delle fondazioni.

## Phase 3: User Story 1 — Accodare e limitare il lavoro tra progetti (Priority: P1)

**Goal**: Eseguire più sessioni senza saturare risorse o far scrivere due agenti nello stesso workspace.

**Independent Test**: Con clock controllato e tre progetti accodare12job; osservare round-robin e cap4/2/2 più lease, poi simulare restart a reservation.

**Coverage**: FR-001–FR-003; FR-010/011/012 trasversali.

- [x] T013 [P] [US1] Scrivere policy/transizioni US1 in `tests/unit/scheduler-us1.test.ts`: Fairness, cap combinati, doppio writer, queue full, restart fra reserve/spawn e debit di processi unknown; testare grant/revisioni e comportamento sicuro (FR-001–FR-003).
- [ ] T014 [P] [US1] Scrivere contract US1 in `tests/contract/scheduler-us1.test.ts`: metodi della storia in `specs/010-session-scheduling/contracts/api.md`, capability assente, input invalidi e azione/grant di altro ambito rifiutati (FR-001–FR-003, FR-011).
- [ ] T015 [P] [US1] Scrivere integrazione locale US1 in `tests/integration/scheduler-us1.test.ts` con fixture di repository/processi/clock pertinenti: Con clock controllato e tre progetti accodare12job; osservare round-robin e cap4/2/2 più lease, poi simulare restart a reservation. Includere crash pre/post effetto, retry e operazioni concorrenti, nessun servizio esterno (FR-001–FR-003, FR-011/012).
- [x] T016 [US1] Implementare tipi/invarianti della storia in `src/domain/scheduler/queue.ts` e aggiornare `src/ports/scheduler.ts` con riferimenti neutri, revisioni e prove richieste, senza OS/SQLite nel dominio (FR-001–FR-003).
- [ ] T017 [US1] Implementare servizio in `src/core/scheduler/admission.ts`: Implementare src/core/scheduler/{queue,resources}.ts e src/ports/resource-sampler.ts; adattare admission009/007/004 ai token con regression limit004 invariato; timer bounded e risveglio su eventi. Test precedenti devono passare, esito incerto resta interrogabile (FR-001–FR-003).
- [x] T018 [US1] Collegare i metodi US1 a `src/core/scheduler/dispatch.ts`, `src/cli/scheduler.ts`, `src/cli/main.ts` e `src/client/local-client.ts`: prepare/confirm, UUID originale, pagine e nessun testo/credenziale in argv; verificare parity con `tests/contract/scheduler-us1.test.ts` (FR-001–FR-003, FR-010).
- [ ] T019 [US1] Esporre US1 in `apps/desktop/src/main/scheduler.ts`, `apps/desktop/src/shared/scheduler-contract.ts`, `apps/desktop/src/preload/index.cts`, `apps/desktop/src/renderer/views/SessionQueue.tsx` e navigazione in `apps/desktop/src/renderer/App.tsx`; aggiungere contract `apps/desktop/tests/contract/scheduler-us1.test.ts` ed E2E `apps/desktop/tests/e2e/scheduler-flow.spec.ts` con ricevuta/confirm, offline, focus, archivi e risposte tardive (FR-010/011/012).

**Checkpoint US1**: scenario indipendente ripetibile con fixture dopo le fasi precedenti; nessun gate reale derivato dal solo test simulato.

## Phase 4: User Story 2 — Attendere quote e riprendere con policy sticky (Priority: P1)

**Goal**: Vedere perché una sessione attende e decidere quando tentare di nuovo senza polling o retry ciechi.

**Independent Test**: Provider fixture segnala QUOTA con reset noto/ignoto; avanzare clock, revocare consenso e verificare che parta al massimo un nuovo run autorizzato.

**Coverage**: FR-004–FR-006; FR-010/011/012 trasversali.

- [ ] T020 [P] [US2] Scrivere policy/transizioni US2 in `tests/unit/scheduler-us2.test.ts`: Reset null, clock avanti/indietro, duplicate wake, restart, revoke prima dispatch, budget3attempt e quota non-auth error; testare grant/revisioni e comportamento sicuro (FR-004–FR-006).
- [ ] T021 [P] [US2] Scrivere contract US2 in `tests/contract/scheduler-us2.test.ts`: metodi della storia in `specs/010-session-scheduling/contracts/api.md`, capability assente, input invalidi e azione/grant di altro ambito rifiutati (FR-004–FR-006, FR-011).
- [ ] T022 [P] [US2] Scrivere integrazione locale US2 in `tests/integration/scheduler-us2.test.ts` con fixture di repository/processi/clock pertinenti: Provider fixture segnala QUOTA con reset noto/ignoto; avanzare clock, revocare consenso e verificare che parta al massimo un nuovo run autorizzato. Includere crash pre/post effetto, retry e operazioni concorrenti, nessun servizio esterno (FR-004–FR-006, FR-011/012).
- [ ] T023 [US2] Implementare tipi/invarianti della storia in `src/domain/scheduler/wait.ts` e aggiornare `src/ports/scheduler.ts` con riferimenti neutri, revisioni e prove richieste, senza OS/SQLite nel dominio (FR-004–FR-006).
- [ ] T024 [US2] Implementare servizio in `src/core/scheduler/wake.ts`: Implementare src/core/scheduler/{wait,recovery}.ts con wallclock UTC persistito e monotonic deadline per run, coalescing dei wake, clock jump conservativo e noretry su esito esterno UNKNOWN. Test precedenti devono passare, esito incerto resta interrogabile (FR-004–FR-006).
- [ ] T025 [US2] Collegare i metodi US2 a `src/core/scheduler/dispatch.ts`, `src/cli/scheduler.ts`, `src/cli/main.ts` e `src/client/local-client.ts`: prepare/confirm, UUID originale, pagine e nessun testo/credenziale in argv; verificare parity con `tests/contract/scheduler-us2.test.ts` (FR-004–FR-006, FR-010).
- [ ] T026 [US2] Esporre US2 in `apps/desktop/src/main/scheduler.ts`, `apps/desktop/src/shared/scheduler-contract.ts`, `apps/desktop/src/preload/index.cts`, `apps/desktop/src/renderer/views/SessionQueue.tsx` e navigazione in `apps/desktop/src/renderer/App.tsx`; aggiungere contract `apps/desktop/tests/contract/scheduler-us2.test.ts` ed E2E `apps/desktop/tests/e2e/scheduler-flow.spec.ts` con ricevuta/confirm, offline, focus, archivi e risposte tardive (FR-010/011/012).

**Checkpoint US2**: scenario indipendente ripetibile con fixture dopo le fasi precedenti; nessun gate reale derivato dal solo test simulato.

## Phase 5: User Story 3 — Applicare fallback e scelta per costo con checkpoint (Priority: P2)

**Goal**: Scegliere alternative compatibili e autorizzate preservando lavoro e privacy.

**Independent Test**: Due provider simulati con capability differenti: autorizzare policy fallback, provare switch sicuro; costo/capability ignoti bloccano cost-aware senza inviare dati.

**Coverage**: FR-007–FR-009; FR-010/011/012 trasversali.

- [ ] T027 [P] [US3] Scrivere policy/transizioni US3 in `tests/unit/scheduler-us3.test.ts`: New recipient consent, tool mismatch, oldrun alive/unknown, stale checkpoint, missing/stale prices e policy revoke race; testare grant/revisioni e comportamento sicuro (FR-007–FR-009).
- [ ] T028 [P] [US3] Scrivere contract US3 in `tests/contract/scheduler-us3.test.ts`: metodi della storia in `specs/010-session-scheduling/contracts/api.md`, capability assente, input invalidi e azione/grant di altro ambito rifiutati (FR-007–FR-009, FR-011).
- [ ] T029 [P] [US3] Scrivere integrazione locale US3 in `tests/integration/scheduler-us3.test.ts` con fixture di repository/processi/clock pertinenti: Due provider simulati con capability differenti: autorizzare policy fallback, provare switch sicuro; costo/capability ignoti bloccano cost-aware senza inviare dati. Includere crash pre/post effetto, retry e operazioni concorrenti, nessun servizio esterno (FR-007–FR-009, FR-011/012).
- [ ] T030 [US3] Implementare tipi/invarianti della storia in `src/domain/scheduler/provider-policy.ts` e aggiornare `src/ports/scheduler.ts` con riferimenti neutri, revisioni e prove richieste, senza OS/SQLite nel dominio (FR-007–FR-009).
- [ ] T031 [US3] Implementare servizio in `src/core/scheduler/switch.ts`: Implementare compatibilità/cost evaluator puro e src/core/scheduler/policies.ts con revisioni/revoca; non assumere transfer conversazione o cancellazione remota verificata se capability false. Test precedenti devono passare, esito incerto resta interrogabile (FR-007–FR-009).
- [ ] T032 [US3] Collegare i metodi US3 a `src/core/scheduler/dispatch.ts`, `src/cli/scheduler.ts`, `src/cli/main.ts` e `src/client/local-client.ts`: prepare/confirm, UUID originale, pagine e nessun testo/credenziale in argv; verificare parity con `tests/contract/scheduler-us3.test.ts` (FR-007–FR-009, FR-010).
- [ ] T033 [US3] Esporre US3 in `apps/desktop/src/main/scheduler.ts`, `apps/desktop/src/shared/scheduler-contract.ts`, `apps/desktop/src/preload/index.cts`, `apps/desktop/src/renderer/views/SessionQueue.tsx` e navigazione in `apps/desktop/src/renderer/App.tsx`; aggiungere contract `apps/desktop/tests/contract/scheduler-us3.test.ts` ed E2E `apps/desktop/tests/e2e/scheduler-flow.spec.ts` con ricevuta/confirm, offline, focus, archivi e risposte tardive (FR-010/011/012).

**Checkpoint US3**: scenario indipendente ripetibile con fixture dopo le fasi precedenti; nessun gate reale derivato dal solo test simulato.

## Phase 6: Polish & Cross-Cutting Review

- [ ] T034 Eseguire build/typecheck/lint e suite mirate core/desktop per i file modificati, aggiornando `specs/010-session-scheduling/reports/validation.md` con matrice FR/SC, comandi/esiti e limiti; non rilanciare acceptance/bench lunghi né promuovere skip a PASS.
- [ ] T035 Verificare le tre storie di `specs/010-session-scheduling/quickstart.md` e i cap del piano; registrare in `specs/010-session-scheduling/reports/qualification.md` prove reali solo se autorizzate e capability effettive, altrimenti NOT_RUN/BLOCKED. Preservare separati gli esiti fixture, provider/login/hosting reali e review umana.
- [ ] T036 Concludere review degli otto principi, permessi e gate precedenti in `specs/010-session-scheduling/reports/release-readiness.md`, aggiornando `specs/010-session-scheduling/tasks.md` solo per lavoro provato; annotare dipendenze ancora bloccate e nessuna integrazione/pubblicazione implicita.

## Dependencies & Execution Order

- Dipendenze feature: 009 runtime/checkpoint e capability;007 install/validation jobs. Discovery004 integrata solo come consumer del budget, con limite1 e policy readonly invariati.
- Schema cumulativo: 9→10; non saltare pacchetti precedenti anche se un servizio è funzionalmente indipendente.
- T001→T002→T003→T004, quindi Phase2; test prima dell’implementazione pertinente. G0 fallito blocca solo la capability dipendente e la relativa qualifica, senza promuovere lo stato.
- US1→US2→US3 nell’ordine del workflow condiviso; le prove di US2/US3 usano fixture dei risultati precedenti e non richiedono un provider reale. Indipendenza significa testabile, non assenza di prerequisiti di dominio.
- Mutazioni su store/protocol/CLI/bridge/view condivisi sono sequenziali. I tre test di ogni storia marcati [P] hanno file distinti e possono essere scritti in parallelo dopo le fondazioni.
- Review finale dopo le tre storie; un esito BLOCKED è ammesso nel report ma non dichiara completata la capability.

## Parallel Examples per User Story

- US1: preparare insieme `tests/unit/scheduler-us1.test.ts`, `tests/contract/scheduler-us1.test.ts`, `tests/integration/scheduler-us1.test.ts`; poi eseguire sequenzialmente dominio→servizio→CLI→desktop (T013–T019).
- US2: preparare insieme `tests/unit/scheduler-us2.test.ts`, `tests/contract/scheduler-us2.test.ts`, `tests/integration/scheduler-us2.test.ts`; poi eseguire sequenzialmente dominio→servizio→CLI→desktop (T020–T026).
- US3: preparare insieme `tests/unit/scheduler-us3.test.ts`, `tests/contract/scheduler-us3.test.ts`, `tests/integration/scheduler-us3.test.ts`; poi eseguire sequenzialmente dominio→servizio→CLI→desktop (T027–T033).

## Traceability & Independent Criteria

| Storia | Requisiti | Task | Criterio indipendente |
|---|---|---|---|
| US1 | FR-001–FR-003 | T013–T019 | Con clock controllato e tre progetti accodare12job; osservare round-robin e cap4/2/2 più lease, poi simulare restart a reservation. |
| US2 | FR-004–FR-006 | T020–T026 | Provider fixture segnala QUOTA con reset noto/ignoto; avanzare clock, revocare consenso e verificare che parta al massimo un nuovo run autorizzato. |
| US3 | FR-007–FR-009 | T027–T033 | Due provider simulati con capability differenti: autorizzare policy fallback, provare switch sicuro; costo/capability ignoti bloccano cost-aware senza inviare dati. |

FR-010/011/012: T005–T012, i tre test e integrazioni CLI/desktop di ogni storia; SC-001–SC-004 validati nei relativi scenari e consolidati T034–T035. I/II→offline/client;III→adapter/capability;IV→precondizioni;V→crash/idempotenza;VI→grant;VII→test prima del codice;VIII→output/quote: tutti nelle fasi pertinenti, non rinviati al polish.

## Implementation Strategy

1. G0 e fondazioni.
2. MVP = US1: Con clock controllato e tre progetti accodare12job; osservare round-robin e cap4/2/2 più lease, poi simulare restart a reservation. Fermarsi al checkpoint per misurare il risultato e registrare limiti.
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
