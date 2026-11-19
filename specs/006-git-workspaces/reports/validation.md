# Validazione 006

## T001 — baseline

19 novembre 2026. Branch `006-git-workspaces-implementation` derivato da `bfeb84f`, chiusura locale della 005 con schema 5. I documenti 006 e 007 sono già presenti in questa linea. Il lockfile desktop non tracciato resta fuori dai commit.

macOS 26.3.1 (a) arm64, Node 26.13.0, npm 11.20.0. Xcode Git 2.50.1 (Apple Git-155) risolto da `xcrun`. Typecheck core e desktop e lint PASS. Le integrazioni di baseline `feature-runtime`, `feature-schema` e `feature-offline` danno 8 PASS, 0 FAIL, 0 SKIP. L’intermittenza globale del replay UPDATE 61 vs 60 resta aperta nella baseline 005. [Review 005](../../005-feature-planning/reports/release-readiness.md)

Restano aperti Foundation 001/T082 e T085, Registry 002/T093, Desktop 003/T054 e la qualifica reale Discovery 004/T028 e T050. Il precheck 004 è `PROVIDER_UNSAFE`. Le prove 006 usano repository temporanei e handoff da fixture dello schema 5. Lo schema 7 della 007 dipende dalle prove di ownership e lease della 006. Le verifiche si limitano a casi mirati, senza riavviare campagne lunghe.

## T002 — casi G0 (RED)

Build:test PASS. Sei casi RED per mutatore ancora assente. Coprono Git fissato con SHA-1 e SHA-256, OID esatto e checkout dirty conservato, canali eseguibili e hook, collisioni e sostituzione di path, SIGKILL prima e dopo worktree add.

## T003 — primitiva di provisioning confinata

Porta Workspace e adapter macOS dietro un profilo dedicato. Git risolve l’OID locale, verificando anchor e configurazione prima dell’effetto. Update-ref crea il branch mediante CAS da assente. Worktree add usa il ref dedicato e l’osservazione successiva correla HEAD, branch, path e file Git. Build:test e suite boundary **6 PASS, 0 FAIL, 0 SKIP**. SIGKILL nelle due finestre lascia evidenza leggibile senza effettuare replay.

## T005 — stato e grant (RED)

Tre unit test RED prima del modello e del namespace WORKSPACE. Coprono transizioni e stati terminali, fence su versione/generazione, cap a 20, scope, scadenza e replay sul solo UUID consumato.

## T006 — schema cumulativo (RED)

Quattro integrazioni RED prima del migratore. La fixture costruisce lo schema 5 dal SQL congelato e verifica lettura storica senza scritture, preservazione dei riferimenti, fault pre/post commit e UUID cross-namespace in entrambi i versi.

## T007 — schema 6 e upgrade esclusivo

Lo start esplicito esegue la catena storica fino a 6. Il passaggio 5→6 conserva operazioni e grant, ricrea i guard UUID e verifica integrità e FK nella stessa transazione sotto le due lease. Reader e worker supportano lo schema cumulativo. Build, build:test, typecheck e lint PASS. Integrazioni schema 006 e regressioni schema/runtime/offline 005 **12 PASS**. Transizioni e fence **2 PASS**. La prova di ammissione del nuovo grant è parte di T008.

## T008 — ledger e reservation condivisi

Namespace WORKSPACE nel ledger esistente. Grant monouso e reservation persistono con contesto, envelope, anchor, branch e quota verificati. La verifica dei byte sigillati precede la reservation. Build:test e suite workspace-state/store e workflow-store **9 PASS**. Artefatto mancante, saturazione e concorrenza lasciano il grant intatto. Un reply loss restituisce l’operazione originale al replay.

## T009 — DTO e lettura storica (RED)

Due casi RED per validator e inspector ancora assenti. Verificano input chiusi, envelope bounded, metodi lease interni, dati storici LAST_KNOWN con UUID originale e assenza di effetti da lettura.

## T010 — protocollo e reader confinato

DTO chiusi per letture e ammissione, cursore legato a store/progetto/revisione, metadata senza path privati. LocalClient verifica la risposta e recupera soltanto l’UUID originale. Workspace e Feature condividono il trasporto e conservano la propria allowlist. Build, build:test, typecheck e lint PASS. Contratti/offline 006 e regressioni CLI/runtime 005 **7 PASS**. La pubblicazione dei metodi live richiede la composizione T011.

## T011 — composizione e drain

Il daemon instrada workspace sullo schema 6 e pubblica soltanto metodi composti. Fence prima della recovery e in stop. Il drain attende lavori già accettati e mantiene un blocco interrogabile quando il termine è superato. Build, build:test, lint e integrazioni workspace/feature runtime **5 PASS**.

## T012 — eventi e budget

Il writer pubblica reservation e metadata workspace nello stesso commit/outbox. Il decoder desktop verifica correlazione e payload chiusi. Un backlog bloccato impedisce nuove admission e conserva letture e replay originali. Typecheck core/desktop, lint e build:test PASS. Suite mirata di eventi, limiti e ledger **8 PASS**.

## T013 — unitario ref e base esatta (RED)

Un caso RED prima del modello di provisioning. Verifica ref generato, base mutata, branch occupato ed evidenza attesa per il passo seguente.

## T014 — contratto di ammissione

1 PASS sul dispatcher iniziale. Nega capability assente, controller, schema storico e campi di comando extra.

## T015 — provisioning locale (RED)

2 RED prima del servizio. Due workspace da handoff fixture, replay sullo stesso UUID, checkout conservato e base mutata dopo prepare.

## T016 — modello di provisioning

Il dominio deriva il ref da UUID, verifica la tupla dell’handoff e distingue base assente/variata, branch occupato ed evidenza per i passi di provisioning. Build:test e prove mirate di modello, store e boundary **10 PASS**.

## T017 — provisioning con Git locale

Il servizio risolve la base locale al prepare e ricontrolla approvazione, pin e OID prima dell’effetto. La reservation persistente e la lease repository precedono ogni scrittura Git. Marker e anchor concordanti precedono READY. La perdita della risposta dopo la creazione del branch conserva branch e reservation con esito UNKNOWN. La recovery porta i provisioning interrotti a RECONCILING senza ripetere i comandi. Build, build:test e lint PASS. Suite mirata **12 PASS**, inclusi due worktree, replay UUID, base mutata e conservazione del checkout e del branch parziale.

## T018 — CLI e parità API

La CLI espone prepare/create/list/show/operation, con UUID esplicito per create, opzioni chiuse e output JSON bounded. Parità CLI/API per pagine storiche, input estraneo respinto prima del trasporto e UUID originale conservato per la mutazione offline. Build e build:test PASS, **4 PASS** tra contratti e reader offline.

## T019 — desktop da handoff

L’handoff approvato apre il progetto nella sezione Workspace. Conferma con ref e OID esatti, ricevuta persistita prima dell’invio, focus dopo Escape, storico offline e archivio cambiato verificati su Electron con worktree Git in una root fixture. Epoch di archivio e generazione della vista scartano risposte tardive. Typecheck e build desktop PASS, **46 PASS** unit/contract e **1 PASS** E2E mirato.

## T020 — proprietà e prova di rilascio (RED)

Due unit test per anchor spostati/sostituiti, HEAD avanzato, scope della lease e prova di uscita o checkpoint riferita alla generazione.
