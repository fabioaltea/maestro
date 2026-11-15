# Tasks: Desktop Core UI

**Input**: `specs/003-desktop-core-ui/{spec,plan,research,data-model,quickstart}.md` e `contracts/`.  
**Status**: Implementazione in corso; checkbox completate solo con evidenza del task.  
**Tests**: Obbligatori per gli invarianti della specifica; scrivere ed eseguire il test pertinente fallente prima dell’implementazione, poi renderlo PASS nello stesso incremento. Non anticipare le mutazioni nelle fasi read-only.

## Format e disciplina

Ogni riga task contiene checkbox, ID sequenziale, `[P]` soltanto dove indipendente, `[USn]` soltanto nelle storie e percorsi esatti. I percorsi codice sono futuri, non file già creati. Un commit locale per task durante implementazione, checkbox solo dopo verifica; nessun push o avvio implementazione da questo documento. G0/G1/... bloccati non si promuovono con mock o disabilitando sicurezza.

## Phase 1: Setup

Predisporre build desktop separata senza alterare build/runtime core.

- [X] T001 Definire manifest privato desktop e pin Electron45.3.0/React19.3.1/esbuild0.28.2/Playwright1.65.0, risolvere tipi React19 compatibili, script npm desktop e lockfile unico in package.json, package-lock.json e apps/desktop/package.json; nessun electron-rebuild o workspace aggiuntivo.
- [X] T002 Configurare build main ESM/preload CJS/renderer ESM e typecheck isolati in scripts/build-desktop.mjs, apps/desktop/tsconfig.main.json, apps/desktop/tsconfig.renderer.json e .gitignore; output dist-desktop separato, nessun dev server.
- [X] T003 Preparare fixture temporanee con ownership, dialog stub solo test, CLI reale, clock/fault controllabili e configurazione Electron Playwright in apps/desktop/tests/fixtures/desktop.ts, apps/desktop/tsconfig.test.json e apps/desktop/playwright.config.ts; usare Node test runner e Playwright senza nuovo runner generico.

## Phase 2: Foundational — gate G0

Verificare confini privilegiati e runtime prima di qualsiasi user story; scrivere test critici prima delle rispettive implementazioni.

- [X] T004 [P] Scrivere contratti negativi e unit test per input/epoch/sender/frame, limiti32KiB e chiamate nominate in apps/desktop/tests/contract/bridge.test.ts, secondo contracts/desktop-bridge.md.
- [X] T005 [P] Scrivere test Node per runtime assoluto, env allowlist, shell:false, JSON valido a exit≠0, overflow/watchdog e ownership CLI in apps/desktop/tests/unit/core-cli.test.ts; fixture risposte generate dalla CLI reale, non inventate.
- [X] T006 Definire DTO plain, validatori chiusi, enum/errori bridge e porte sostituibili in apps/desktop/src/shared/bridge-contract.ts, apps/desktop/src/shared/validation.ts e apps/desktop/src/main/ports.ts; revisioni/seq stringhe, nessun import implementativo core.
- [X] T007 Implementare adapter CLI con Node26 esterno validato, argv sicuri, quote-free shell:false, parser PublicResult per comando e limiti2letture/1mutazione/1stream in apps/desktop/src/main/core-cli.ts e apps/desktop/src/main/runtime.ts; esporre letture, mantenere mutazioni non raggiungibili fino a US2.
- [X] T008 Implementare launcher di sviluppo che passa process.execPath verificato, build path canonici e ambiente privo di injection in scripts/run-desktop.mjs; errore runtime/build sicuro senza install/download o autostart daemon.
- [X] T009 [P] Scrivere smoke Electron reale e test ostili CSP/origine/frame/protocol traversal/navigazione/rete/assenza Node nel renderer in apps/desktop/tests/e2e/security.spec.ts e apps/desktop/tests/e2e/bootstrap.spec.ts; verificare Node CLI legge SQLite offline senza moduli nativi in Electron.
- [X] T010 Implementare singleton, window sandboxed, protocollo maestro://app con path allowlist e CSP, blocco permessi/navigazioni e handler con sender validation in apps/desktop/src/main/index.ts, apps/desktop/src/main/security.ts e apps/desktop/src/main/protocol.ts; aggiungere bootstrap React minimale in apps/desktop/src/renderer/index.html, apps/desktop/src/renderer/index.tsx e apps/desktop/src/renderer/App.tsx per rendere eseguibile lo smoke G0, senza dati/scritture; nessuna importazione bootstrap/storage core.
- [X] T011 Implementare preload CJS con sole API nominate, subscribe/unsubscribe e validazione runtime in apps/desktop/src/preload/index.cts e apps/desktop/src/main/bridge.ts; niente invoke/fs/spawn/token generici o accesso mutativo prima di conferma US2.
- [X] T012 Estendere guard AST esistente per separazione core/main/preload/renderer e secret-free bounded logging in scripts/check-architecture.mjs e apps/desktop/src/main/safe-log.ts; aggiungere casi guard in apps/desktop/tests/contract/architecture.test.ts prima della modifica del guard.
- [X] T013 Eseguire build/typecheck/lint e spike reale Electron/Playwright sul Mac target, senza allentare sandbox; registrare versioni, output e gate G0 PASS/BLOCKED in specs/003-desktop-core-ui/reports/validation.md, lasciando invariati i gate001/002.

## Phase 3: US1 — Consultare i progetti locali (P1, MVP)

Archivio selezionabile, lista e dettaglio coerenti live/offline; nessun autostart o scrittura. Independent test: archivio CLI100progetti, daemon attivo/fermo, tutti i progetti raggiungibili e dati storici etichettati.

- [X] T014 [P] [US1] Scrivere unit test per epoch, risposte tardive, pagine invalidated, null/observation LAST_KNOWN e ring cache100 in apps/desktop/tests/unit/project-view.test.ts.
- [X] T015 [P] [US1] Scrivere integrazione CLI+archivio reale su letture live/offline/assente, snapshot non mutato e REGISTRY_CHANGED in apps/desktop/tests/integration/project-reads.test.ts, prima degli handler UI.
- [X] T016 [US1] Implementare contesto archivio main con picker, handle opachi, epoch/store e invalidazione richieste/listener in apps/desktop/src/main/archive-context.ts e apps/desktop/src/main/read-handlers.ts; scelta assente tramite contenitore+nome validato, nessuna creazione implicita.
- [X] T017 [US1] Implementare reducer di lista/dettaglio e proiezione stretta dei DTO core in apps/desktop/src/renderer/state/project-view.ts; pagina25/cache100, stale response discard, restart elenco coerente e tombstone.
- [X] T018 [US1] Estendere il bootstrap G0 con shell React e stati accessibili loading/empty/offline/error a1280×800 in apps/desktop/src/renderer/App.tsx, apps/desktop/src/renderer/index.tsx, apps/desktop/src/renderer/index.html e apps/desktop/src/renderer/styles.css; asset locali e niente pannelli futuri.
- [X] T019 [US1] Implementare elenco paginato e dettaglio con date/freschezza/flag sconosciuti, selezione archivio e polling status5s senza sovrapposizioni solo finestra visibile in apps/desktop/src/renderer/views/Projects.tsx e apps/desktop/src/renderer/views/ProjectDetail.tsx; nessun probe Git implicito.
- [X] T020 [US1] Eseguire E2E consultazione da tastiera, live/offline/assente, cambio archivio con risposta tardiva e100progetti in apps/desktop/tests/e2e/projects-read.spec.ts; documentare G1 e prima misura SC-001/002 in specs/003-desktop-core-ui/reports/validation.md.

## Phase 4: US2 — Lifecycle esplicito e recovery (P1)

Controllare daemon con UUID e conferme, senza possederne il lifecycle. Independent test:10cicli avvio/chiusura/CLI status/riapertura/arresto e crash/reply loss senza reinvio.

- [X] T021 [P] [US2] Scrivere unit test di conferme monouso/TTL60s/hash/epoch e blocchi delle operazioni incerte in apps/desktop/tests/unit/confirmations.test.ts.
- [X] T022 [P] [US2] Scrivere integrazione ricevute crash-safe fsync-before-spawn,100file/4KiB, permessi/symlink/corruzione, query ID assente e store diverso in apps/desktop/tests/integration/receipts.test.ts; nessuna eviction unresolved o replay payload.
- [X] T023 [US2] Implementare ricevute minime atomiche0700/0600 con fsync file+directory, validazione e limite100 in apps/desktop/src/main/receipt-store.ts; nessuna scrittura allo store core, fallimento persistenza blocca invio.
- [X] T024 [US2] Implementare prepare/confirm/cancel con token scoped e UUID stabile, preflight liveness/store e blocco equivalenti incerte in apps/desktop/src/main/confirmations.ts e apps/desktop/src/main/action-handlers.ts; ricevuta prima di singolo spawn, mai resubmit automatica.
- [X] T025 [US2] Implementare query e riconciliazione startup delle sole ricevute originali con namespace/store verificati in apps/desktop/src/main/operation-recovery.ts; NOT_FOUND/INVALID_REQUEST resta UNKNOWN, sola dismiss di terminali e nessun retry UI.
- [X] T026 [P] [US2] Scrivere integrazione lifecycle con CLI/core reali, doppio clic, crash prima/dopo invio, shutdown client e controller detached superstiti in apps/desktop/tests/integration/lifecycle.test.ts; segnali limitati agli handle client posseduti.
- [X] T027 [US2] Collegare start/stop/restart e lettura esito ai contratti CLI/bridge in apps/desktop/src/main/lifecycle.ts e apps/desktop/src/main/bridge.ts; start su archivio assente solo esplicito, core auth/idempotenza invariati.
- [X] T028 [US2] Implementare stato operazione, riepilogo/conferma stop/restart e schermata ricevute con Aggiorna esito in apps/desktop/src/renderer/views/DaemonControls.tsx, apps/desktop/src/renderer/views/Operations.tsx e apps/desktop/src/renderer/components/ConfirmationDialog.tsx; focus/keyboard, nessun falso successo a timeout.
- [X] T029 [US2] Gestire close finestra/crash renderer/cambio archivio chiudendo soltanto listener e CLI possedute, senza daemon stop o killpg, in apps/desktop/src/main/client-lifecycle.ts e apps/desktop/src/main/index.ts; operazioni accettate indipendenti e ricevute conservate.
- [X] T030 [US2] Eseguire10cicli e fault E2E con riavvio UI/query stesso ID, cap ricevute e controllo niente client orfani illimitati in apps/desktop/tests/e2e/lifecycle.spec.ts; registrare G2/SC-003 e aspetti SC-007 in specs/003-desktop-core-ui/reports/validation.md.

## Phase 5: US3 — Registrazioni progetto (P2)

Esporre importazione/verifica/update/remove esistenti, con snapshot repository invariati. Independent test:20sequenze reali con confronto CLI, duplicati e revisione concorrente.

- [X] T031 [P] [US3] Scrivere contratti per handle repository, patch keep/set/clear, expectedRevision, richieste offline e token/intent variato in apps/desktop/tests/contract/project-actions.test.ts.
- [X] T032 [P] [US3] Scrivere integrazione su import duplicato, unborn/detached, dirty/conflitti, verify negativo salvato, CAS/update/remove/reimport nuovo UUID in apps/desktop/tests/integration/project-actions.test.ts, con snapshot repository prima/dopo.
- [X] T033 [US3] Implementare picker repository e handler prepare/confirm project.register/verify/update/remove sulla ricevuta comune in apps/desktop/src/main/project-actions.ts; verificare LIVE prima invio, UUID/revisioni allowlist, nessuna coda offline o Git diretto.
- [ ] T034 [US3] Implementare form import con riepilogo e azione intenzionale, duplicato che seleziona registrazione esistente e input correggibile in apps/desktop/src/renderer/views/ImportProject.tsx; nessun clone/init/install.
- [ ] T035 [US3] Implementare azione Verifica e presentazione datata di observation/null/errori probe distinti dal salvataggio in apps/desktop/src/renderer/components/ProjectObservation.tsx e apps/desktop/src/renderer/views/ProjectDetail.tsx.
- [ ] T036 [US3] Implementare form nome/base con distinzione invariata/impostata/cancellata e dialog revisione approvata in apps/desktop/src/renderer/views/EditProject.tsx; revision conflict invalida conferma e richiede revisione utente, mai force.
- [ ] T037 [US3] Implementare Rimuovi dal registro con nome/UUID/revisione, tombstone e conservazione file esplicita in apps/desktop/src/renderer/components/RemoveProjectDialog.tsx; vecchia ricevuta non influenza UUID reimportato.
- [ ] T038 [US3] Collegare aggiornamenti lista/dettagli e errori sicuri per tutte le azioni senza ottimismo prima esito core in apps/desktop/src/renderer/state/project-actions.ts; invalidare viste/cursori dopo mutazioni e conservare input consentiti.
- [ ] T039 [US3] Eseguire20sequenze e casi concorrenti/reply loss/doppio invio/permessi negati in apps/desktop/tests/e2e/project-actions.spec.ts; registrare G3/SC-004 con snapshot e parità CLI in specs/003-desktop-core-ui/reports/validation.md.

## Phase 6: US4 — Attività e diagnostica (P2)

Consegnare quattro incrementi separati E1→E2→E3→E4. Independent test: operazioni CLI reali osservate in UI, interruzioni/replay/gap e consumer lento senza blocco daemon.

- [ ] T040 [P] [US4] E1: scrivere contratti storia/diagnostica PublicResult live/offline, cursor pagina e redazione in apps/desktop/tests/contract/activity-history.test.ts.
- [ ] T041 [US4] E1: implementare letture bounded storia persistita/diagnostica e mapping codici sicuri in apps/desktop/src/main/activity-history.ts, con CLI esistente e nessun accesso store diretto.
- [ ] T042 [US4] E1: implementare pannelli storia/diagnostica, FIFO500/4MiB e applicazione pagine/cursor senza salto highWater in apps/desktop/src/renderer/views/Activity.tsx, apps/desktop/src/renderer/views/Diagnostics.tsx e apps/desktop/src/renderer/state/activity.ts.
- [ ] T043 [US4] E1: qualificare storia reale persistita e offline prima del live in apps/desktop/tests/integration/activity-history.test.ts; registrare checkpoint E1 in specs/003-desktop-core-ui/reports/validation.md.
- [ ] T044 [P] [US4] E2: scrivere test parser NDJSON split UTF-8, frame64KiB, versioni/store/ordine, started/event/closed e PublicResult errore pre-stream in apps/desktop/tests/unit/activity-stream.test.ts.
- [ ] T045 [US4] E2: implementare singolo CLI follow con handle owned, parser bounded e batch scoped main→renderer in apps/desktop/src/main/activity-stream.ts; al massimo un batch32/64KiB pendente, nessuna raw stderr o seconda connessione.
- [ ] T046 [US4] E2: collegare ascolto/unsubscribe e ACK dopo applicazione batch in apps/desktop/src/preload/index.cts e apps/desktop/src/renderer/state/activity-stream.ts; main mantiene lastApplied distinto da cursor CLI ricevuto.
- [ ] T047 [US4] E2: verificare nuovi eventi reali e passaggio storia→live senza duplicati in apps/desktop/tests/integration/activity-live.test.ts; checkpoint E2 in specs/003-desktop-core-ui/reports/validation.md.
- [ ] T048 [P] [US4] E3: scrivere integrazione disconnect/crash stream/callback fallita, duplicati e seq gap/store diverso/CURSOR_EXPIRED in apps/desktop/tests/integration/activity-replay.test.ts; nessun avanzamento prima ACK.
- [ ] T049 [US4] E3: implementare Riconnetti esplicito dal cursore applicato, duplicate discard, gap e rilettura stato senza reinvio comandi in apps/desktop/src/main/activity-recovery.ts e apps/desktop/src/renderer/components/ActivityContinuity.tsx; nuova app dichiara finestra storia disponibile senza continuità persistita.
- [ ] T050 [US4] E3: eseguire replay reale e gap con storia scaduta in apps/desktop/tests/e2e/activity-replay.spec.ts; registrare checkpoint E3 in specs/003-desktop-core-ui/reports/validation.md.
- [ ] T051 [P] [US4] E4: scrivere pressione reale/simulata, backlog256KiB, ACK2s mancante/errato, FIFO500/4MiB e client shutdown in apps/desktop/tests/integration/activity-pressure.test.ts; nessuna crescita illimitata o terminazione daemon.
- [ ] T052 [US4] E4: completare pause stdout, watchdog ACK, gestione saturazione e chiusura del solo stream owned in apps/desktop/src/main/activity-pressure.ts e apps/desktop/src/main/activity-stream.ts; esporre DISCONNECTED/GAP/SATURATED e ultimo cursor applicato.
- [ ] T053 [US4] E4: eseguire carico client100eventi/s per10min,1000campioni latenza e carico reale core separato in apps/desktop/tests/e2e/activity-pressure.spec.ts; registrare SC-005/G4 e raw campioni in specs/003-desktop-core-ui/reports/performance.md senza attribuire throughput fixture al core.

## Phase 7: Polish e review trasversale

Completare verifica003 e documentazione, senza promuovere gate esterni bloccati e senza integrazione/pubblicazione implicita.

- [ ] T054 [P] Completare prove tastiera/focus/label/errori/contrasto e contenuti ostili su tutti i flussi a1280×800 in apps/desktop/tests/e2e/accessibility.spec.ts; registrare review picker reale e screenshot essenziali in specs/003-desktop-core-ui/reports/validation.md.
- [ ] T055 [P] Qualificare privacy/limiti log2MiB×2, nessun segreto/credenziale/raw stderr, race archivio/receipt e tentativi privilegiati negati in apps/desktop/tests/e2e/privacy.spec.ts e apps/desktop/tests/contract/safe-log.test.ts; SC-007 e NFR-001/003.
- [ ] T056 Misurare30aperture100progetti e30dettagli per modalità live/offline, p95/massimi/ambiente e raw campioni in apps/desktop/tests/e2e/performance.spec.ts e specs/003-desktop-core-ui/reports/performance.md; distinguere target SC-001/002 da misure senza riusare risultati002.
- [ ] T057 Eseguire build/typecheck/lint e npm test core più suite desktop, controllando che core resti eseguibile senza UI; registrare esiti reali/failure/skip in specs/003-desktop-core-ui/reports/validation.md, senza rilanciare campagne600s immotivate.
- [ ] T058 Documentare avvio checkout, runtime esterno, offline, conferme, recovery receipt e limiti della prima UI in README.md e specs/003-desktop-core-ui/quickstart.md; aggiornare soltanto parti generate di AGENTS.md preservando manual block.
- [ ] T059 Mappare ogni scenario/FR/NFR/SC ai test/evidenze, valutare gate G0–G4 e readiness003 in specs/003-desktop-core-ui/reports/release-readiness.md; mantenere001/T082,001/T085,002/T093 BLOCKED finché non qualificati realmente, nessuna release/merge/push automatica.

## Dipendenze e parallelismo

```text
Setup → Foundation/G0 → US1/G1 (MVP read-only)
                           ├→ US2/G2 → US3/G3
                           └→ US4 E1 → E2 → E3 → E4/G4
G2 + G3 + G4 → Polish → review003
```

US2 dipende dalla shell/archivio US1; US3 riusa le ricevute/conferme US2. US4 è dimostrabile con operazioni prodotte dalla CLI e non richiede le scritture UI US2/US3. Non far concorrere modifiche agli stessi file (`bridge.ts`, `index.cts`, `Activity`/stream o report): coordinare integrazione sequenziale. I task `[P]` sono paralleli soltanto dopo i prerequisiti del relativo incremento, mai rispetto alla loro implementazione dipendente.

Esempi per storia:

- US1: unit reducer e integrazione letture possono essere preparati in parallelo dopo G0; UI segue test/handler.
- US2: test token e test receipt in parallelo dopo G1; storage prima di dispatch; test lifecycle pronto prima dei relativi handler.
- US3: contratti azioni e integrazione repository in parallelo dopo G2; form import/edit separabili soltanto dopo handler comune e senza scrivere gli stessi file.
- US4: lavoro test del prossimo incremento può essere preparato mentre si qualifica il precedente, ma E2 dipende da E1 e E3 da E2; pressione E4 non viene rinviata alla polish. Non eseguire prove performance contemporaneamente ad altre suite.

## Delivery e checkpoint

1. Fermarsi a G1 permette una UI utile in sola lettura (MVP), anche a servizio fermo.
2. Aggiungere lifecycle G2 e registrazioni G3 senza modificare dominio/schema/protocollo daemon.
3. US4 cresce con quattro checkpoint separati; finché replay/backpressure non sono qualificati non dichiarare completo lo streaming.
4. Ogni story conserva independent test e può essere dimostrata con fixture/CLI del core. Release readiness globale distinta dai checkpoint locali.

## Copertura verificabile

| Requisiti / invarianti | Incremento e verifica |
|-----------------------|----------------------|
| FR-001/002/003, I/II/III | G0 confini/runtime + US1 epoch/offline/pagine, no capacità simulate |
| FR-004/005/006, V/VI | US2 UUID/conferme/receipt/crash/lifecycle/query UNKNOWN |
| FR-007/008/009/010, IV/VI | US3 picker/duplicati/osservazioni/CAS/snapshot/offline; ricevute US2 |
| FR-011, VIII | US4 E1 storia, E2 live, E3 replay/gap, E4 pressure/ACK |
| FR-012/013, II/VII/VIII | G0 guard/sandbox/CLI/validazione + privacy/regressione finale |
| FR-014, SC-006 | UI nelle singole storie, verifica trasversale tastiera/contrasto |
| NFR-001/002/003 | G0 locale/macOS, limiti adapter/receipt/eventi/log, test privacy/pressione |
| NFR-004/005 | test obbligatori per incremento e report misure/NOT_RUN/BLOCKED |
| SC-001/002 | G1 prima osservazione + campagna performance finale30campioni |
| SC-003/004/005/007 | G2/G3/G4 e confini/privacy finali |

Per la review finale mappare anche ciascuno scenario numerato della specifica, non soltanto gruppi di requisiti. I test core non richiedono Electron; nessun provider, credenziale reale o servizio esterno nei test003. Runner reale secondo UID/macchina e profilo IP-denied Foundation restano gate001/002 separati, senza deroga.

## Conteggio

59 task totali: setup 3, foundation 10, US1 7, US2 10, US3 9, US4 14, polish 6. Nessun task completato.
