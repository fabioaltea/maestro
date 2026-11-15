# Review003 — prima UI locale

Data2026-11-15. Branch003-desktop-core-ui; baseline001/002 integrata localmente
in main72381375dcc31b54dcebf05666a0d7b4ab9c8ef3. Nessun merge003, push o release.

## Decisione

Implementazione locale disponibile dal checkout; **REVIEW_PENDING** per T054,
review umana e picker nativo reale NOT_RUN. Readiness globale **BLOCKED** dai gate
esterni001/T082,001/T085,002/T093: secondo UID/macchina e campagna IP-denied non
qualificati da questi test. Non sono stati creati account o allentate policy.

Il carico100eventi/s per10min e la campagna1000eventi sono **DEFERRED** su richiesta
esplicita dell’utente; spec/plan/tasks aggiornati. G4 riguarda eventi reali e fault
bounded. La prova lunga iniziale fallita per chiusura finestra non è PASS né una
prova di stabilità; dettaglio in [performance](performance.md).

## Gate

| Gate | Esito locale | Evidenza |
|---|---|---|
| G0 confini/runtime | PASS | security/bootstrap, contract bridge/architecture/core-cli, build/types/guard |
| G1 consultazione | PASS | projects-read integration/E2E,100progetti, archive snapshot, epoch/revision guard |
| G2 lifecycle/recovery | PASS | lifecycle10cicli, SIGKILL reale e risposta persa, receipt fsync/query UUID |
| G3 registrazioni | PASS |20sequenze UI, snapshot conflitti/dirty, CAS/duplicato/reimport, CLI parity |
| G4 eventi essenziali | PASS nello scope rivisto | E1storia/E2live/E3replay/E4limiti e10operazioni reali, ACK mancanti/errati |
| Review trasversale | PENDING | automatici accessibilità/privacy/performance; review umana T054 aperta |
| Release core globale | BLOCKED |001/T082,001/T085,002/T093 invariati |

## Scenari della specifica → verifiche

Percorsi relativi a `apps/desktop/tests/`. U=unit/contract, I=integrazione,
E=Electron reale. Copertura composta non equivale a un test E2E di ogni variante.

| Scenario | Test / evidenza | Esito e limite |
|---|---|---|
| US1.1 elenco100/dettaglio | E projects-read, performance; I project-reads | PASS,4pagine25, tutti100unici |
| US1.2 offline senza scritture | I project-reads; E projects-read/performance | PASS snapshot immutato, nessun autostart |
| US1.3 archivio assente/inaccessibile/incompatibile | E projects-read assente; U core-cli/error catalog; test core inspection/schema | Assenza PASS, errori core propagati; picker/accessibilità reale da review manuale |
| US1.4 invalidazione/risposta tardiva | U project-view; I project-reads/action-dispatch; E privacy archive switch | PASS composed, epoch/store/revision guard |
| US1.5 observation/null | U project-view; I project-reads; E projects-read/project-actions | PASS datata/LAST_KNOWN, null non clean |
| US2.1 avvio confermato/idempotenza | U confirmations; I action-dispatch/lifecycle; E lifecycle-bridge/lifecycle | PASS, UUID stabile/singolo invio |
| US2.2 close/crash superstite | I lifecycle; E lifecycle SIGKILL e10cicli | PASS daemon indipendente |
| US2.3 stop/restart/esito | E lifecycle/accessibility; I lifecycle | PASS, esito originale; UNKNOWN non successo |
| US2.4 reply loss/reconcile | I operation-recovery/receipts/action-dispatch; E lifecycle SIGSTOP+SIGKILL | PASS query originale, nessun replay |
| US3.1 import/duplicato | I project-actions; E project-actions | PASS identità/config preservata |
| US3.2 verify negativo/unborn | I project-actions; E project-actions | PASS unavailable/null/datata, snapshot invariato |
| US3.3 patch approvata | U project-actions/bridge; E project-actions | PASS keep/set/clear e nome |
| US3.4 CAS concorrente | I project-actions; E project-actions | PASS input conservato, nuova review |
| US3.5 rimozione/reimport | I project-actions; E project-actions20sequenze | PASS soli metadati, nuovo UUID |
| US3.6 offline/busy/incerto | U confirmations/project-actions; I action-dispatch; E privacy/lifecycle | PASS nessuna coda, query UUID |
| US4.1 storia→live | I activity-history/activity-live; E activity-history/activity-live | PASS ordine/identità, lettura offline |
| US4.2 reconnect/gap | I activity-replay; E activity-replay | PASS restart reale e retention floor scaduto, recupero esplicito |
| US4.3 limiti/consumatore lento | I activity-pressure; U activity; E activity-pressure | PASS ACK2s, backlog256KiB/FIFO500/4MiB; stabilità prolungata non qualificata |
| US4.4 diagnostica sicura | U activity-history/safe-log; I activity-history; E privacy/activity-history | PASS soli codici/correlazioni, no segreti/stderr |

## Requisiti funzionali

| Requisito | Test/evidenza |
|---|---|
| FR-001 capacità attuali | architecture guard, E bootstrap/navigation; nessun provider/runtime/worktree/install/merge |
| FR-002 archivio esplicito | I project-reads; E projects-read/privacy; picker umano NOT_RUN |
| FR-003 viste coerenti | U project-view; I project-reads; E projects-read/performance/privacy |
| FR-004 lifecycle indipendente | I lifecycle; E lifecycle10cicli e crash |
| FR-005 conferme/UUID | U confirmations; I action-dispatch/receipts; E lifecycle-bridge |
| FR-006 esito/recovery | I operation-recovery; E lifecycle reply loss; nessun bottone reinvio |
| FR-007 import sicuro | I/E project-actions; snapshot repository |
| FR-008 verify esplicito | I/E project-actions, observation datata e negativa salvata |
| FR-009 patch/remove/CAS | U project-actions; I/E project-actions;20sequenze |
| FR-010 niente offline queue | U confirmations; contract project-actions; E privacy |
| FR-011 attività in incrementi | E1–E4 in validation; activity-history/live/replay/pressure |
| FR-012 confini/ownership | architecture/core-cli/client-lifecycle; E security/lifecycle |
| FR-013 input/secret | bridge/core-cli/safe-log; E security/privacy/accessibility testo ostile |
| FR-014 tastiera/focus | E accessibility PASS; review manuale T054 PENDING |

## NFR e criteri misurabili

| ID | Evidenza / stato |
|---|---|
| NFR-001 local-first | asset locali/CSP connect-src none, nessun servizio remoto, test offline; IP-denied completo separato BLOCKED |
| NFR-002 piattaforma | macOS26.3.1 arm64/APFS, Electron45.3.0/Node26.13.0; altre piattaforme non qualificate |
| NFR-003 limiti | core-cli/bridge/receipt/safe-log/activity-pressure; tutte le tabelle plan con cap/timeout osservabile |
| NFR-004 test separati | npm test headless + unit/contract/integration desktop + Electron, fixture con ownership |
| NFR-005 misure oneste | performance.md/raw JSON, cache/carico/n/p95/max/limiti; nessun riuso dei risultati002 come misura UI |
| SC-001 |30aperture/100progetti, p95≤2s PASS; campioni view-performance-samples |
| SC-002 |30live+30offline, p95≤1s/2s PASS; tutti i60dettagli con freschezza corretta |
| SC-003 |10cicli, daemon superstite e stop≤12s PASS; lifecycle-samples |
| SC-004 |20sequenze e snapshot/parità PASS; project-action-samples e fault specifici |
| SC-005 rivisto |10operazioni reali/20eventi, p95≤1s; replay/gap/ACK2s/limiti PASS; volume/durata DEFERRED |
| SC-006 | automatici tastiera/contrasto5viste PASS; umana/picker NOT_RUN, criterio PENDING |
| SC-007 | confini e privacy locali PASS; nessuna promozione dei gate esterni identità/IP-denied |

## Constitution

I locale: asset/archivio locale, snapshot offline. II headless: CLI Node esterno,
Electron senza SQLite/import core, daemon superstite. III nessun provider simulato.
IV snapshot dirty/conflitti e CAS, nessuna mutazione Git aggiunta. V ricevute durevoli,
UUID/query originali, no replay. VI conferme monouso scoped e policy autorevoli core.
VII porte sostituibili, fixture reali locali e test invarianti. VIII diagnostica/log
redatti bounded, cursore ACK, replay/gap espliciti. Guard AST PASS.

## Review restante e limiti

- T054: completare [review umana/picker reale](manual-review.md); checkbox aperta.
- Stabilità sotto carico prolungato non qualificata; chiusura inattesa nella prima
  campagna sintetica conserva stato FAIL/deferred, richiede indagine se si riprende quel carico.
- 001/T082,001/T085,002/T093 restano gate globali BLOCKED; nessuna deroga.
- Solo app dal checkout, un archivio/finestra, cursore non persistito; nessun installer,
  firma/notarizzazione, autoupdate o distribuzione multipiattaforma.
- Nessuna integrazione/pubblicazione automatica: review003 prima di decidere il merge.

## Esito finale della verifica

Build/typecheck core e desktop, lint AST PASS. Core368/368, unit/contract desktop26/26,
integrazioni22/22, Electron22/22 e performance UI1/1 separata:0failure/skip negli
automatici finali. [Dettaglio](final-verification.json), [validation](validation.md),
[misure](performance.md). Non equivalgono a review umana o gate esterni PASS.

59/60task completati; T054 aperto per la sola parte umana. T059 è una review
conclusa con REVIEW_PENDING locale e BLOCKED globale, senza autorizzare il merge.
Commit locali per task. Il file apps/desktop/package-lock.json preesistente/non
tracciato è stato preservato, escluso dai commit: il progetto usa il lockfile root.

## T060 — distinzione archivio/progetto corretta da review

Il problema segnalato dall’utente nel picker reale era chooseArchive seguito da
UNAUTHORIZED, prima dell’importazione. Schermata iniziale e form distinguono ora
archivio dati1:Nprogetti; setup→Servizio esplicito e Apri archivio separato da Importa
progetto. Marker.git senza store presente respinto con istruzione utile, selezione
precedente e repository invariati. L’autorità su permessi/validità store resta al core.

[Verifica mirata](archive-project-ux-verification.json):28unit/contract,5integrazioni,
7casi Electron qualificati fra il giro mirato e la ripetizione del file setup.
Screenshot archive-intro/archive-setup ispezionati localmente. Core e gate esterni
invariati; benchmark lunghi non riaperti. T054 resta aperto per completare la review
umana, con feedback iniziale ricevuto e corretto.
