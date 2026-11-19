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

## T021 — superficie di refresh

Il contratto rifiuta capability assente e input con grant, holder, generazione, PID o revisione non permessi. Il lease resta un’operazione interna.

## T022 — lease e refresh locale (RED)

Fixture Git con due holder concorrenti, prova di uscita legata alla generazione, refresh datato, replay UUID e spostamento reale del worktree senza perdita dei file. I fault della primitiva Git restano coperti da T002–T004 e T017.

## T023 — modello della proprietà

Gli anchor e il marker vincolano l’identità del worktree. Il commit può avanzare senza cambiare proprietà. La lease richiede prova di uscita dell’albero o checkpoint durabile quiescente su holder e generazione esatti. **2 PASS** mirati.

## T024 — lease interne e riconciliazione

Lock writer persistente e generazioni per consumer core. Il successore mantiene il blocco dopo perdita dell’istanza fino a prova di quiescenza dello stesso holder. Refresh data Git status e proprietà, mantiene i file quando l’anchor cambia e riconcilia il provisioning interrotto solo con worktree, marker e approvazione concordanti senza ripetere Git. Le claim residue verificabili sono recuperate sotto lease. Build, build:test e lint PASS, **14 PASS** mirati e **3 PASS** integrazione US2 dopo la prova di successor.

## T025 — CLI refresh

L’osservazione esplicita usa workspace, revisione e UUID originali. CLI e RPC rifiutano grant, holder o generazioni aggiunti dal chiamante. Build e build:test PASS, **2 PASS** di contratto.

## T026 — desktop refresh

Refresh richiede conferma dalla vista Workspace e conserva la ricevuta originale. Mostra l’ora, l’HEAD e le categorie dei file anche offline, con refresh disabilitato. Il recupero osservativo è disponibile anche quando una mutazione precedente è incerta. **47 PASS** unit/contract, **1 PASS** E2E mirato con file non tracciato, focus e storico.

## T027 — invarianti cleanup (RED)

Due test per modifiche tracked/untracked/ignored, conflitti, holder, target variato, ancestry e prova di assenza a passi.

## T028 — contratto cleanup

1 PASS per target locale e OID, grant/revisione chiusi, capability mancante e niente path o force nel DTO.

## T029 — cleanup Git reale (RED)

Due casi fixture per lavoro dirty e non integrato conservato, rimozione provata e risposta persa dopo il primo effetto con ref e UUID originali preservati.

## T030 — policy cleanup

L’idoneità richiede proprietà, stato, target e ancestry correnti e assenza di lavoro locale o lease. La prova finale distingue ref conservato e rimozione completa. Build:test e **2 PASS** mirati.

## T031 — cleanup con ancestry e CAS

Il cleanup lega grant, owner, HEAD e target, poi separa la rimozione non forzata dal CAS del ref. Conserva marker e branch negli esiti parziali; il successore chiude il caso post-CAS solo dopo aver verificato l’assenza. Il lock temporaneo del backend Git resta limitato alla singola invocazione. Packed ref generati, target mosso e lavoro locale bloccano il cleanup. **4 PASS** integrazione US3 e **8 PASS** G0.

## T032 — CLI cleanup

La prova del target viaggia in JSON bounded da file o stdin. Remove richiede grant, revisione e UUID esatto. **2 PASS** di contratto locale e reader offline senza eligibility positiva.

## T033 — desktop cleanup

La vista espone ref/OID del target, conferma, ricevuta e stato aggiornato. Il test Electron rifiuta il file non tracciato, mantiene il focus dopo Escape e completa la rimozione solo dopo aver ripulito la fixture. Typecheck PASS, **48 PASS** unit/contract e **1 PASS** E2E su tre storie.

## T034 — validazione mirata

| Verifica | Esito |
| --- | --- |
| Build, build:test, typecheck core e lint architettura | PASS |
| Unit, contract e integrazioni 006, regression workflow-store e feature-runtime | 50 PASS, 0 FAIL, 0 SKIP |
| Typecheck desktop, build desktop, unit/contract | 48 PASS, 0 FAIL, 0 SKIP |
| Integrazioni desktop mirate di dispatch, storico, ricevute, recovery e registry | 13 PASS, 0 FAIL, 0 SKIP |
| Playwright Electron, workspace-flow.spec.ts | 1 PASS, 0 FAIL, 0 SKIP in 30,2 s |

La prima esecuzione mirata desktop ha rilevato un ciclo di import ESM nel contratto workspace. Le primitive di validazione sono ora importate da un modulo indipendente e la suite che riproduceva il ciclo passa. Il selettore Workspace usa la pagina da 25 progetti prevista dal bridge.

| Requisiti | Evidenza su fixture |
| --- | --- |
| FR-001–003, SC-001 e SC-003 | Due feature creano branch e directory distinti. Una scrittura in una directory resta locale. Dieci retry dello stesso UUID lasciano un solo risultato e nessuna nuova revisione o ref. |
| FR-004–006, SC-004 | Refresh datato, lease concorrenti, holder perso, anchor spostato, SIGKILL prima e dopo worktree add e ricevute persistenti con recovery senza replay. |
| FR-007–009, SC-002 | Conservazione nei casi coperti di sporco, file ignorato arrivato tardi, lease attiva, target mosso, ref packed, commit non integrato e proprietà incerta. CAS riuscito su ref loose e verifica dopo risposta persa. |
| FR-010–012 | CLI/desktop, archivio cambiato, storico offline, UUID cross-namespace, quote, backpressure ed eventi senza informazioni private. |

Le integrazioni hanno usato repository e archivi temporanei. Non sono state ripetute acceptance/bench o campagne di durata.
