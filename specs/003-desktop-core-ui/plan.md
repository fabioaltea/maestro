# Implementation Plan: Desktop Core UI

**Branch**: `003-desktop-core-ui` | **Date**: 2026-11-11 | **Spec**: [spec.md](spec.md)  
**Input**: `/specs/003-desktop-core-ui/spec.md`

## Summary

Prima app Electron locale, React, un archivio e una finestra: consultazione anche offline, lifecycle esplicito, gestione registrazioni e attività. Il main usa esclusivamente la CLI JSON esistente con il Node supportato; il renderer non accede a filesystem, credenziali, SQLite o processi. Nessun codice core, schema, protocollo daemon o orchestratore aggiuntivo pianificato. L'app è eseguibile dal checkout; distribuzione pubblica esclusa.

001 e 002 sono stati integrati in `main` tramite due fast-forward fino a `72381375dcc31b54dcebf05666a0d7b4ab9c8ef3`, senza conflitti, prima della creazione del branch 003. L'integrazione locale è autorizzata dall'utente; non è una dichiarazione di release acceptance. Restano 001/T082, 001/T085 e 002/T093 aperti/BLOCKED.

## Technical Context

**Language/Version**: TypeScript 6.0.3 strict; core Node.js 26.13.0, ESM/NodeNext; main Electron Node24 ESM, preload CJS, renderer browser ESM/TSX.  
**Primary Dependencies**: Electron 45.3.0, React/react-dom 19.3.1, esbuild 0.28.2; @playwright/test 1.65.0 per test desktop. Pin da qualificare nel gate G0; tipi React19 compatibili risolti e bloccati nel lockfile al bootstrap.  
**Storage**: SQLite schema3 esistente esclusivamente tramite CLI/core. Ricevute UI non autorevoli in userData privato, massimo100, senza payload replayabile. Nessuna migrazione DB, preferenza o indice progetti UI.  
**Testing**: Node test runner esistente per unit/contract/integration, Playwright Electron per desktop reale; fixture temporanee. npm test continua headless, test desktop separati, nessun nuovo runner generico.  
**Target Platform**: macOS26.3/26.3.1 arm64/APFS, runtime core già qualificato; sviluppo da checkout, non installer firmato.  
**Project Type**: desktop-app client del core headless esistente.  
**Performance Goals**: SC-001–007: prima pagina p95≤2s, dettaglio live≤1s/offline≤2s, feedback stop≤12s, eventi p95≤1s; campioni e carichi definiti in spec/quickstart. Sono target non misurati per003.  
**Constraints**: nessun servizio remoto, porta HTTP o shell; nessuna telemetria/auto-update; un archivio/finestra; niente autostart daemon; limiti tabella seguente.  
**Scale/Scope**:100 progetti, pagina25; quattro storie, snapshot limitato e singolo stream; nessun provider/agent/discovery/worktree/pnpm/merge/release.

## Constitution Check

| Principio | Prima ricerca | Dopo design / evidenza richiesta |
|-----------|---------------|----------------------------------|
| I Local-first | PASS: FR-002/NFR-001 | PASS design: asset locali, CLI e archivio locale, test offline senza mutazioni; nessun network renderer/main richiesto. |
| II Headless | PASS: FR-004/012 | PASS design: Node esterno; Electron non importa bootstrap/SQLite. Close/crash chiude solo client posseduti; integration+desktop su daemon superstite. |
| III Provider agnostic | PASS: FR-001 | PASS design: nessun provider/SDK o capacità simulata; controlli import. Checkpoint provider N/A. |
| IV Git safety | PASS: FR-007/009 | PASS design: riuso sole operazioni registro, nessuna mutazione Git; snapshot dirty/conflitti e CAS core. Worktree/merge/cleanup N/A. |
| V Recovery | PASS: FR-005/006 | PASS design: ricevuta fsync prima invio, UUID stabile, query originale, nessun replay; crash/reply loss testati. Nessuna policy Agent Runtime introdotta. |
| VI Approvals | PASS: FR-005/009 | PASS design: conferme main monouso/scoped e CAS/autenticazione autorevoli core; stale revision nega, mai force/retry implicito. Pubblicazione/deploy N/A. |
| VII Testability | PASS: NFR-004 | PASS design: porte sostituibili main, test Node e desktop reali G0–G4; test invarianti nello stesso incremento. |
| VIII Observability | PASS: FR-011/013 | PASS design: PublicResult e stream esistenti, redazione e limiti, cursore ACK e gap, incrementi E1–E4. |

PASS indica conformità documentale, non esecuzione dei test. Gate runtime G0–G4 sono obbligatori nell'implementazione. Nessuna deroga costituzionale: la UI è la milestone successiva alle feature001/002, la Foundation resta headless.

## Project Structure

### Documentation

```text
specs/003-desktop-core-ui/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── checklists/requirements.md
├── contracts/desktop-bridge.md
├── contracts/core-cli-adapter.md
├── contracts/ui-flows.md
└── tasks.md
```

### Source Code — previsto, non creato in questa fase

```text
apps/desktop/
├── package.json                 # private manifest Electron, main compiled entry
├── tsconfig.main.json
├── tsconfig.renderer.json
├── playwright.config.ts
├── src/main/                    # window/security, dialog, CLI adapter, receipts
├── src/preload/index.cts        # contextBridge bundle CJS
├── src/shared/                  # soli DTO/validatori puri
├── src/renderer/                # React, viste e reducer senza Node
└── tests/{unit,contract,integration,e2e}/
scripts/build-desktop.mjs
scripts/run-desktop.mjs
scripts/check-architecture.mjs    # estendere guard esistente
src/                            # core esistente invariato
```

**Structure Decision**: Nessuna ristrutturazione npm workspace. Dipendenze desktop/test tutte devDependencies root con lockfile unico; manifest desktop minimale privato, nessun install annidato. Build root core invariata; build desktop in `dist-desktop/{main,preload,renderer}` con manifest copiato per Electron. Config TypeScript separate perché tsconfig core include soltanto src. Source import di soli DTO core ammesso nel main via type-only, conversione runtime validata; renderer/shared non importano implementazioni core.

## Runtime, processi e sicurezza

Launcher `npm run desktop` pianificato: build core → build desktop → `node scripts/run-desktop.mjs`. Lo script verifica Node26.13.0 e passa al main il percorso assoluto corrente. Il main rivalida realpath/versione/entrypoint CLI canonico prima di spawn, ambiente allowlist senza NODE_OPTIONS/NODE_PATH/ELECTRON_RUN_AS_NODE/DYLD. Mancanza runtime/build = schermata errore sicura, nessuna installazione automatica. Il core non viene ricompilato per Electron. Privilegi renderer negati; protocollo `maestro://app` registra soltanto asset bundle con host/metodo/path allowlist e traversal/symlink escape negati. CSP `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'`; vietati eval, inline script/style e risorse remote. Nessun HTML non fidato/injection. Main blocca navigazione/window.open/webview/permessi e convalida webContents, top frame, origine e payload a ogni chiamata/ACK. La firma del DTO non è una prova di autorizzazione.

Singleton dell'app per userData con `requestSingleInstanceLock`; seconda apertura porta in primo piano la finestra esistente. Chiusura finestra su macOS termina l'app client in questa milestone; nessun tray. I processi CLI sono posseduti tramite handle ChildProcess vivo, nessuna scansione PID o killpg. Close/timeout può interrompere solo quei client, mai controller/daemon già detached. Alla perdita del main le pipe si chiudono, le CLI finite restano limitate dai timeout core; lo stream termina su EPIPE. Test reale deve verificare assenza di client superstiti non limitati.

## Limiti del client

| Risorsa | Limite / comportamento |
|---------|------------------------|
| Processi CLI | massimo2 letture +1 mutazione +1 stream per app; nessuna coda comandi, capacità esaurita → BUSY locale |
| Letture | timeout core2s, watchdog subprocess3s; stato non sovrapposto, polling solo finestra visibile ogni5s |
| Controllo | start/restart core30s+watchdog2s; stop core10s+2s; progetto mutazione30s+2s; errore watchdog dopo invio → UNKNOWN |
| stdout risposta | 256KiB UTF-8; stdout JSON valido valutato anche con exit nonzero; overflow = errore/UNKNOWN se mutazione |
| stderr |16KiB catturati, mai inoltrati/loggati grezzi; oltre limite chiusura client e errore sicuro |
| JSONL |64KiB per frame, decoder UTF-8 incrementale rigoroso; backlog main256KiB massimo |
| Storia/viste | pagina progetti25, massimo100 record nella cache UI; dettaglio singolo; eventi massimo500 record e4MiB, espulsione FIFO esplicita |
| Invio eventi | batch massimo32 record/64KiB, un batch non confermato; ACK2s, nessun ACK/overflow → chiusura stream posseduto e continuità interrotta |
| Richieste bridge |32KiB per invocazione, massimo8 letture IPC pendenti; ACK massimo1KiB; input extra respinti |
| Ricevute |100 file, massimo4KiB ciascuno; cartella0700/file0600, no symlink, atomic rename+fsync file e directory. Saturazione blocca nuove mutazioni; eliminabili esplicitamente soltanto ricevute terminali riconciliate |
| Log UI | solo codici/UUID/azioni e tempi, massimo2MiB×2 file; no pathname progetti, intenti, credenziali o stderr |

Limiti sono scelte progettuali da testare, non misure. Conflitti con limiti core più restrittivi si risolvono rispettando il minimo; limiti UI non aumentano capacità core.

## Flussi, recovery e design

Layout a 1280×800: header archivio/stato, lista progetti con pagine, area dettaglio/form, pannello Attività/Diagnostica. Stati vuoto/loading/offline/errore distinti, nessun pannello agenti fittizio. Conferme e input da tastiera, focus restituito al trigger, aria-live per esiti, colore mai unico indicatore, contrasto minimo4.5:1 testo normale. CSS locale, nessuna libreria UI/router necessaria.

Main possiede `selectionEpoch`; ogni risposta include epoch e storeId quando noto. Cambio archivio invalida conferme, viste e stream, non operazioni già inviate. Cache e richieste obsolete sono scartate. Elenco REGISTRY_CHANGED riparte senza mescolare pagine. Il flag LIVE del registro non rende corrente un'osservazione Git LAST_KNOWN. Tutti i dati non verificati restano null/indicati; nessun branch discovery aggiuntivo, base configurata tramite testo qualificato e validazione core.

Per mutazioni: prepare main → riepilogo+token → conferma → ricevuta durevole → spawn CLI con UUID stabile. Ogni token dura60s, è monouso e legato a finestra/epoch/store o archivio assente approvato/action/target/revisione/hash intent. Il main ricontrolla ambito e disponibilità prima dell'invio; store sostituito o revisione cambiata invalida. Il core verifica autenticazione, ownership/idempotenza e CAS; nessuna nuova policy approvazioni generale nel core.

Al riavvio main rilegge ricevute come indizi, interroga il core per namespace/UUID sull'archivio corretto e mostra esiti/incertezza. PREPARED significa “potrebbe essere inviato”. OPERATION_NOT_FOUND/INVALID_REQUEST non provano mancato effetto; nessuna risottomissione UI. Finché incerto: bloccare ulteriori controlli daemon sullo stesso archivio, ulteriori modifiche allo stesso progetto, e nuove importazioni in caso di import incerto; altri progetti leggibili. L'utente può aggiornare stato e query originale o consultare diagnostica, senza pulsante forzatura. Cambio archivio non cancella ricevute né le riassegna a store differente. Non si salva il payload per replay. Il blocco locale non sostituisce le policy del core per altri client.

## Incrementi e gate

1. **G0 / Setup e Foundation**: build/typecheck desktop indipendenti, spike reale Electron/Playwright con sandbox/preload/protocollo, Node/CLI offline senza ABI Electron, confini CLI e sicurezza testati. Se fallisce non disabilitare sandbox; registrare blocco.
2. **G1 / US1 MVP**: app read-only per archivio/progetti, live/offline. Gate: archivio invariato, nessun autostart, letture coerenti, renderer confinato.
3. **G2 / US2**: lifecycle e ricevute/riconciliazione, doppio click, crash e chiusura senza fermare servizio. Gate:10 cicli e fault su finestre pre/post invio.
4. **G3 / US3**: import → verify → update/remove, test CAS/duplicati/dirty/conflict e errore; nessuna mutazione repository.
5. **G4 / US4**: **E1 storia persistita**, **E2 live**, **E3 replay/gap**, **E4 pressione/ACK** ciascuno con test prima della relativa implementazione e checkpoint separato. E1 non dipende da E2; E2/E3 non qualificati completi senza E4.
6. **Review finale**: accettazione003, accessibilità, carichi e regressione core, README e report evidenze. Gate esterni001/002 restano BLOCKED se non eseguiti realmente, senza falsa promozione. Nessuna integrazione/pubblicazione/implementazione automatica dal presente piano.

## Complexity Tracking

Nessuna violazione costituzionale. Costi motivati: adapter subprocess per evitare una seconda ABI SQLite e duplicazione IPC; ricevute UI minime perché la query core richiede UUID e il crash del main non deve perderlo. Rifiutati secondo daemon, nuovo RPC, database UI e framework generici anticipati. La ricevuta non autorizza retry e non è stato autorevole del prodotto.
