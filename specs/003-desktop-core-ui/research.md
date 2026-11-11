# Research — Desktop Core UI

Data: 2026-11-11. Ricerca solo documentale/sorgenti, nessuna compatibilità runtime desktop ancora misurata.

## Gate prima della ricerca

Tutti gli otto principi verificati sulla specifica: I locale/offline, II client separato, III nessun provider, IV repository in sola ispezione, V identità/recovery senza replay automatico, VI conferme e controlli core, VII test richiesti, VIII osservabilità bounded. PASS di design preliminare; non è accettazione runtime. La prima milestone rimane headless: 003 è una milestone successiva autorizzata. I gate 001/002 restano aperti.

## R1 — Desktop e versioni

**Decision**: Electron 45.3.0, React/react-dom 19.3.1, esbuild 0.28.2 e @playwright/test 1.65.0, pin esatti da verificare nel bootstrap; TypeScript 6.0.3 già nel repository. Tipi React 19 compatibili da risolvere e bloccare nel lockfile durante T001. Nessun cambio del runtime core Node 26.13.0.

**Rationale**: Il brief indica Electron/React/TypeScript. Electron 45.3.0 incorpora Node 24.22.2: non è il runtime del core e non deve caricarne gli adapter nativi.

**Alternatives considered**: Web server locale aumenta superficie e cambia target; UI nativa cambia stack del brief; bundler/dev server completo non necessario al primo incremento.

Fonti primarie: [Electron stable](https://releases.electronjs.org/?channel=stable), [React 19.3.1](https://github.com/facebook/react/releases/tag/v19.3.1), [esbuild 0.28.2](https://github.com/evanw/esbuild/releases/tag/v0.28.2), [Playwright 1.65.0](https://github.com/microsoft/playwright/releases/tag/v1.65.0).

## R2 — Riutilizzare la CLI come adapter del desktop

**Decision**: Electron main lancia la CLI JSON esistente mediante Node 26.13.0 esterno verificato, percorso assoluto, argv costruito da allowlist e `shell:false`. Le letture sono processi transitori; un solo processo CLI di stream può restare collegato mentre Attività è aperto. Nessun nuovo servizio, entrypoint core, driver SQLite Electron o protocollo daemon.

**Rationale**: `src/bootstrap.ts` importa gli inspector con SQLite; `src/platform/macos/launcher.ts` e `src/storage/readonly-host.ts` usano `process.execPath`. Importarli in Electron causerebbe ABI/binario/policy diversi. La CLI possiede già credenziali, controlli, protocollo, lettura offline confinata e recovery.

**Alternatives considered**: Importare direttamente `createClientBackend` richiede duplicare native build e compromette il launcher; implementare IPC/SQLite nel main duplica gli adapter; nuovo sidecar RPC è complessità inutile. Il subprocess CLI è un client posseduto dall'app, non un secondo daemon né un runner di test.

Il launcher di sviluppo `scripts/run-desktop.mjs`, avviato dal Node supportato, passa il proprio percorso assoluto al main. Il main verifica binario reale/versione con ambiente allowlist privo di `NODE_OPTIONS`, `NODE_PATH`, `ELECTRON_RUN_AS_NODE` e variabili DYLD. Nessuna ricerca shell, installazione o download automatici. Il core resta compilato da Node e carica il proprio better-sqlite3 13.0.3. Nessun electron-rebuild sul core.

## R3 — Confine Electron e build

**Decision**: Una finestra, renderer React senza Node, `contextIsolation:true`, `sandbox:true`, `nodeIntegration:false`, `webSecurity:true`; preload CJS bundle `.cjs` con sole API nominate. Main ESM e renderer browser ESM, tre build esbuild separate e typecheck tsc distinto. Protocollo locale `maestro://app` con origine/path allowlist; CSP restrittiva senza inline script/eval o risorse remote. Nessun dev server o porta HTTP.

**Rationale**: Il preload sandboxed non supporta ESM nativo. La sicurezza richiede validare frame mittente e schema oltre al solo nome del canale. Nessun accesso generico a IPC, fs, spawn, credenziali o process.env nel renderer.

**Alternatives considered**: nodeIntegration e generic invoke ampliano i permessi; file:// rende meno chiaro il confine origine; librerie di stato/router/CSS non necessarie a quattro viste locali.

Fonti: [Electron security](https://www.electronjs.org/docs/latest/tutorial/security), [context isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation), [ESM/preload](https://www.electronjs.org/docs/latest/tutorial/esm), [protocol](https://www.electronjs.org/docs/latest/api/protocol), [esbuild TypeScript](https://esbuild.github.io/content-types/#typescript).

## R4 — Recovery e conferme

**Decision**: Il main conserva prima di ogni mutazione una ricevuta privata durevole, distinta dallo store autorevole, con UUID originale e soli metadati necessari a query/review. Nessuna coda offline o payload eseguibile. Conferma monouso lega finestra, selezione archivio, azione, hash del contenuto e revisione. Il core mantiene autenticazione, idempotenza e precondizioni autorevoli; una conferma UI non amplia le autorizzazioni del core.

**Rationale**: Il core consente query per UUID, ma non offre un catalogo pubblico di tutte le operazioni. Senza ricevuta prima dell'invio, crash del main può perdere l'ID. Receipt PREPARED non dimostra che il comando non sia partito. Operazione assente/non leggibile lascia incertezza: si interroga e si aggiorna lo stato, mai reinvio automatico. La prima UI non offre un pulsante di retry mutazione incerta.

**Alternatives considered**: Solo memoria perde identità al crash; persistere tutti gli input crea una coda di intenti e raccoglie dati inutili; nuovo ledger nel DB core modifica inutilmente lo schema 3. Preferenze e cursori non vengono persistiti in questa milestone, solo ricevute necessarie a recovery.

## R5 — Eventi in incrementi e limiti

**Decision**: Prima pagina di storia, poi stream CLI JSONL, poi replay esplicito con cursore applicato, infine pressione/gap. Il main tratta il cursore CLI come ricevuto, mai come applicato dalla UI. L'ACK renderer dopo applicazione controllata fa avanzare il cursore main; duplicate precedenti scartate, salto interrompe e impone rilettura. Main e renderer hanno code finite; chiusura del solo client stream posseduto in caso di saturazione.

**Rationale**: `src/cli/main.ts` offre già subscription.started/event/subscription.closed e segue gli eventi usando `LocalClient`. Replay copre lo spazio tra pagina e sottoscrizione. La pipe non prova applicazione nella vista; il main deve mantenere questo confine esplicito.

**Alternatives considered**: WebSocket/server secondario inutile; polling continuo perde valore stream; replay automatico dei comandi vietato. Nessun retry automatico degli stream nella prima versione: Riconnetti è esplicito.

## R6 — Verifica

**Decision**: Node test runner esistente per modelli/main tramite porte e fixture; Playwright Electron per UI reale con core reale temporaneo. Spike prima delle storie per coppia Electron/Playwright, sandbox/preload/protocollo e accesso CLI a daemon spento. Playwright Electron resta sperimentale: il gate è un test reale, non una promessa di compatibilità delle versioni.

**Rationale**: Nessun nuovo orchestratore di test. Dialoghi nativi tramite adapter sostituibile solo nell'harness test esterno alla build normale; picker reale anche in review manuale. Le prove IP-denied e UID/macchina reali restano separate: i blocchi attuali non sono risolti da Electron o da mock.

Fonti: [Playwright Electron](https://playwright.dev/docs/api/class-electron), [Electron native modules](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules).
