# Validation004 — evidenze di implementazione

## Stato

Implementazione avviata2026-11-16 sul branch004-project-discovery, basee9c8491.
Nessuna qualifica reale provider, login, installazione o invio di sorgenti eseguiti.
I gate001/002 e la review umana003 restano invariati.

## T001 — setup e confini

- macOS26.3.1(a), build25D771280a, Darwin25.3.0, arm64; Node26.13.0, npm11.20.0.
- Pin Codex controllato read-only: CLI0.167.0, SHA256
  `030316ecfbb41f4e7946e584b0063ef333b7a36cd312ba349f2f6869e39b62cc`.
  Help conferma no-daemon/ignore-user-config/ignore-rules/ephemeral/output-schema.
  Version/help non dimostrano i permessi effettivi o il login.
- Probe OS minimale sandbox-exec→true: exit0. Non è G0, che richiede il provider
  reale e tentativi ostili con backend sintetico.
- Ignore verificati per repository Node/desktop: dipendenze, build, env/segreti,
  database/runtime e risultati test. Nessun Docker/ESLint/Prettier/Terraform/Helm
  rilevato, package private non pubblicato: nessun ignore ulteriore necessario.
- Guard AST estesa alla zona providers; dominio/client non possono importarla.
  Adapter provider non importano storage/core/platform/Electron/SQLite. Asset
  Discovery `.sb`/`.schema.json` copiati nei soli output previsti dallo script esistente.
- PASS `npm run build`, `npm run build:test`, `npm run typecheck`, `npm run lint`.
- PASS `node --test dist-tests/tests/contract/architecture.test.js`:3/3,0skip.
  Comprende import statici/dinamici/re-export/require, modulo non statico,
  dipendenze vietate provider e regressione dominio/client.
- Nessun package/lockfile/runner nuovo; lockfile desktop preesistente non tracciato
  lasciato fuori dalle modifiche. G0/G1 NOT_RUN; nessuna soglia runtime misurata.

## T002 — casi G0 prima del codice (RED atteso)

- Fixture temporanee con canary, config/rules/skill/hook/MCP ostili, backend HTTP
  Responses locale limitato a12richieste/4MiB, nessun account/chiave reale.
- Test sul pin, argv/env chiusi, policy OS tramite probe nativo, catalogo reale
  e iniezioni sintetiche apply_patch/read-auth/write-checkout/shell-exec.
- PASS compilazione `npm run build:test`. Test mirato:8test,1PASS (hash pin),
  7FAIL attesi per ERR_MODULE_NOT_FOUND delle implementazioni T003,0skip.
  I test restano eseguibili e falliscono esplicitamente, senza falsi PASS/skip.
- La checkbox T002 attesta i casi RED, non G0. Il gate resta NOT_RUN e i task
  dipendenti non sono autorizzati finché la qualifica T004 non è PASS.
- Fixture SSE/config confrontate con la documentazione ufficiale consultata:
  [Responses streaming](https://developers.openai.com/api/reference/resources/responses/streaming-events),
  [config reference](https://learn.chatgpt.com/docs/config-file/config-reference).

## T003 — invocazione e profilo nativo

- Builder puro con pin/hash/policy, stdin, schema trusted, argv/env chiusi, keyring,
  nessun prompt/endpoint arbitrario, no approvazioni del modello o shell snapshot.
- Launcher minimale bounded: controlla binario arm64/hash/identità, directory private,
  schema e UUID tecnico; rifiuta wrapper e input oltre2MiB prima di eseguire.
  Nessun metodo daemon/CLI Discovery o UI è ancora esposto.
- Scratch per-run separato da auth; sqlite_home diretto nello scratch. La CLI richiede
  accesso in scrittura al solo installation_id non segreto, anche se preesistente.
  Aggiunta eccezione letterale UUID verificato; auth.json/token/config e tutti i
  target protetti restano negati. Dettaglio nel contratto provider-runtime.
- OTEL_SDK_DISABLED da solo non disabilita l’exporter interno: aggiunti override
  analytics=false/feedback=false/exporter=none; nessuna metrica con contesto esportata.
  Diagnostica esplorativa solo su fixture sintetiche, rimossa dai test.
- Schema wire root object chiusa, ramo inattivo null; validazioni semantiche e
  provenance rimangono T022/T039. Nessuna promessa di validazione da exit0.
- PASS build/build:test/typecheck/lint. PASS6/6 test mirati architettura+launcher.
- PASS primo comando esplicito `npm run test:discovery:boundary`:8/8,0skip,
  2335,59ms osservati su questa macchina (non una soglia o una garanzia).
- Il comando usa il runner Node esistente; qualifica esplicita con guard env. Le
  suite ordinarie segnalano G0 come separato/non eseguito, non lo promuovono a PASS
  in assenza del pin. La qualifica esplicita fallisce invece senza piattaforma/pin.
- Backend sintetico con egress OS ristretto al singolo port loopback; account
  ufficiale/inferenza reale non usati. T004 consolida evidenza e limiti del gate.

## T004 — consolidamento G0

G0 PASS sintetico:8/8,0FAIL/0SKIP; pin/profilo/schema/digest e limiti in
[provider-qualification.md](provider-qualification.md). Asset dist/dist-tests
identici ai source. Nessuna eccezione sulle credenziali o sui dati di progetto.
G1/SC-001 NOT_RUN e gate preesistenti invariati. Foundation ora può procedere
con fixture locali; configurazione e modello reali richiederanno verifica dedicata.

La regressione ordinaria `npm test` è stata avviata separatamente; il suo esito
sarà registrato alla conclusione, senza confonderlo con la qualifica G0.

## Baseline ordinaria dopo T004

`npm test` concluso:377test,372PASS,0FAIL,5SKIP,151689,47ms osservati.
I cinque skip sono i cinque casi G0 top-level, esclusi per default dalla suite
ordinaria e qualificati separatamente8/8 nel comando esplicito. Nessun altro
skip, provider reale o benchmark introdotto. Conteggi precedono i casi T005.

## T005 — stato/intenti prima del dominio (RED atteso)

PASS build:test;8/8 casi nuovi falliscono per moduli dominio non ancora presenti,
0skip. Slot WAITING_USER/RECONCILING, uscita provata, approvazione distinta,
UPDATING, fasi spawn, grant scope/TTL/replay, byte Unicode e limiti numerici.
La checkbox attesta i test RED richiesti; T006 deve portarli a PASS.

## T006 — dominio e porte neutri

Implementati tipi/limiti, transizioni distinte Discovery/run/operation, canonizzazione
chiusa degli intenti, grant scope/scadenza/replay e porte provider/context/runtime/store.
Documenti e approvazioni hanno tipi propri senza dipendenze Codex/OS/SQLite/UI.
WAITING_USER/RECONCILING occupano lo slot; nessuna uscita incerta lo libera.
Aggiunto caso RED per fallimento spawn precoce: EXIT_OBSERVED richiede prova anche
prima di PROVIDER_RUNNING, poi può finalizzare senza fasi di avvio inventate.
PASS build/build:test/typecheck/lint e15/15test mirati,0skip (dominio9,guard3,launcher3).
Nessuna API operativa aggiunta e schema attivo ancora3: T008 introduce l’upgrade.
La baseline ordinaria ha rigenerato cinque campioni storici002: ripristinati ai
byte iniziali del checkout, senza cambiare i gate o committare nuovi esiti002.

## T007 — upgrade/ledger prima del codice (RED atteso)

Schema3 congelato in fixture indipendente dal codice corrente, con righe
Foundation/registry/identità/sequenze conservabili. Casi nuovo schema4,3→4 e
2→3→4, reader3 senza mutazioni, lease/deadline/writer concorrente, fault pre/post
commit e SIGKILL del solo figlio posseduto. Casi ledger su replay/conflitti UUID
incrociati e admission atomica grant/session/run/slot con secondo start negato.
PASS build:test;8test nuovi,8FAIL attesi (schema attuale3/moduli T008–T009 assenti),
0skip. T008 porta a PASS l’upgrade, T009 i due casi ledger separati.

## T008 — schema4 e upgrade esplicito

Writer4, reader2/3/4, registry≥3; SQL storico STORE/REGISTRY V3 e migrazione2→3
separati dal nuovo3→4. start esplicito acquisisce entrambi i lease e migra;
status/read non migrano. Creazione15tabelle Discovery separate, slot/grant/ledger,
FK differite per admission atomica, UUID guard incrociate e artefatti senza blob.
Policy processi agent-runtime separata, managed_resources Foundation invariato.

PASS build/build:test/typecheck/lint;41/41test mirati upgrade/registry/reader,0skip.
Comprende7casi004, crash prima/dopo commit, rollback fault, chain2→3→4, righe
Foundation/registry/journal preservate e reader3 senza nuove scritture. Nuovi
negativi: tabella sconosciuta nello schema3 o tabella Discovery mancante nel4
bloccano upgrade/apertura. SQL constraints delle versioni storiche restano3.

I test di creazione archivio corrente usano SCHEMA_VERSION invece di3 hardcoded;
le fixture/aspettative storiche2→3 e reader3 restano congelate. readonly-database
e sqlite-driver erano già version-neutral e non hanno richiesto modifiche.
Nessun archivio dell’utente aperto o migrato. I due casi ledger T007 restano RED
fino a T009, non rientrano nei41PASS dichiarati.

## T009 — ledger, slot e grant nel writer esistente

Admission atomica con UUID globale e trigger incrociati; grant consumato soltanto
con sessione/run/slot durevoli. Risposta interna inserted=false su replay, nessun
nuovo evento o run; payload differente e collisione con LIFECYCLE/PROJECT negati.
Reservation query unificata e reader schema<4 con DISCOVERY_NOT_INITIALIZED.
Grant attivi max32 con posto riservato cancel; query e cancellation non richiedono
una nuova autorizzazione start. Riserva byte artefatti ancora T012.

Stesso worker/SQLiteStore, nessun secondo writer; adattatore interno sincrono
(mai Promise dentro una transazione SQLite). Il proxy worker resta asincrono.
Operation query metadata omette intento/hash privati prima del reader64KiB;
metadata operation.accepted scope=discovery è pubblicato nella stessa commit.
Tipologie Discovery e UI allowlist complete restano T016/T025.

PASS build/build:test/typecheck/lint;28/28test mirati. Coprono grant cap/cancel,
replay con inserted=false, slot occupato senza consumo del secondo grant, fault
prima della commit senza evento/operazione, proxy worker e reader confinato,
mutazioni readonly negate e notifiche persistenti sul canale onFailure esistente.
PASS `npm test`:400test,395PASS,0FAIL,5SKIP (G0 separato),136036,06ms osservati.
Campioni JSON002 rigenerati dalla suite ripristinati ai byte iniziali, senza
committare esiti storici nuovi. Nessun login o modello reale eseguito.

## T010 — metadata persistenti,2026-11-17

API provider/snapshot/processi/run/domande/risposte/revisioni/approvazioni/output
nel worker esistente, con modulo storage/discovery-metadata separato dal ledger.
DTO chiusi, CAS, identità/generazioni, limiti e pagine bounded; manifest/corpus e
documenti grandi restano riferimenti a file. Nessuna API SQL generica.

PASS build/build:test/typecheck/lint. Dieci nuovi test metadata coprono provider
CAS/campi segreti, query chiuse, domande solo dopo uscita provata, WAITING_USER e
slot, risposta+run atomici/idempotenti, revisioni immutabili, consenso esatto per
approvare, output/watermark, processi separati Foundation, paginazione20domande
grandi, worker/readonly e risultati operation limitati a IDs. Sono fixture di
metadati: non sostituiscono la qualifica filesystem T012 o native recovery T018.

Prima campagna completa:410test,399PASS,6FAIL,5SKIP. Sei timeout in casi002 già
esistenti; il registro macOS conferma Idle Sleep178s durante l’esecuzione. Nessun
fallimento viene promosso a PASS da quella campagna. Ripetizione con assertion
anti-idle limitata alla durata del comando (`caffeinate -i npm test`):410test,
405PASS,0FAIL,5SKIP (G0 separato),138167,05ms osservati. Nessuna soglia allungata,
nessuna campagna600s o chiamata provider reale. Assertion terminata col comando.
Campioni002 rigenerati dalla suite ripristinati, gate storici invariati.

La UI/CLI Discovery non è ancora esposta: questo checkpoint completa soltanto
le API interne dei metadati. Output eventi ancora incrementale, nessun nuovo
stream token o secondo servizio.

## T011 — test artefatti inizialmente RED,2026-11-17

Quindici casi locali compilano e falliscono come atteso perché le API artefatti
T012 non esistono ancora (15FAIL/0PASS,607,78ms). Coprono ordine reservation/fsync/
publish/DB e interruzioni nei sette checkpoint, letture bounded/hash, file mancanti
o alterati, link/permessi/owner, orfani preservati e conteggiati, pagine SQLite
Discovery e indici, riserva terminale e preview/discard/pinning. Fixture private
nel runner Node esistente; nessun account, sorgente utente o modello reale.
La checkbox attesta la definizione dei test, non la qualifica del filesystem.

## T012 — artefatti e quota nello stesso writer,2026-11-17

Implementato discovery-artifacts nel worker esistente, senza nuovi pacchetti o
writer: reservation DB prima dei byte, staging esclusivo UUID0600, fsync file,
link esclusivo senza overwrite, unlink del solo staging verificato, fsync delle
directory e commit hash/metadata. Root0700 con identità ricontrollate. Letture
raw≤8KiB solo da oggetti registrati, regolari0600/nlink1/owner valido, hash e
fstat verificati. Nessuna promozione da filename, riparazione o cancellazione
automatica. Il filesystem privato protegge dal provider confinato; non si dichiara
una sandbox contro un attaccante con controllo dello stesso UID/codice Maestro.

Quota64MiB fisici/4096nomi, compresi staging e orfani conservati, più pagine btree
Discovery e indici. Un inode temporaneamente con due nomi dopo un crash viene
conteggiato conservativamente due volte e non letto come pubblicato. Directory
sconosciute/link impediscono nuove scritture senza essere attraversati/eliminati.
La freelist globale SQLite resta nel diagnostic budget esistente, non duplicata
come pagina Discovery: nessun aumento del budget50MiB o WAL2MiB. Ultimi5MiB e due
posti riservati a proof/finalizzazione; grant cancel/admission e recovery usano
capacità terminale. Il limite100Discovery resta nell’admission T009.

Preview max4/TTL15min e pinning T010 conservati. Discard esplicito rimuove soltanto
metadata di preview senza sessioni/revisioni; decrementa riferimenti e conserva
gli oggetti come orfani conteggiati. Nessuna eviction di revisioni/approvazioni.

PASS typecheck/lint/build.21test artefatti/quota PASS (ultima verifica2985,80ms):
sette fault sincroni, tre SIGKILL reali su figli posseduti, hash/file mancanti/link/
permessi, controllo UID con stat sintetico (non una prova secondo UID), proxy
worker e readonly, pagine DB/indici e allocazione effettiva, limite4096, quota
ordinaria esaurita con grant/admission cancel su WAITING_USER e una approvazione
storica ancora presente/leggibile. La prova di cancellazione qui riguarda la
persistenza: non sostituisce la terminazione nativa T018/T033.

PASS suite generale `caffeinate -i npm test`:431test,426PASS,0FAIL,5SKIP G0
separati,143365,83ms osservati. Dopo l’avvio della suite è stata aggiunta soltanto
la liberazione della mappa reservation nella riconciliazione e rafforzata la
fixture cancel; i21test mirati ricompilati sullo stato finale sono tutti PASS.
Campioni002 rigenerati ripristinati ai byte originali. G1/account/modello reale
NOT_RUN; readiness/gate001/002/003 invariati.

## T013 — test contesto inizialmente RED,2026-11-17

Quattordici casi compilano e falliscono come atteso per adapter T014 ancora
assente (14FAIL,2339,19ms). Repo temporanei reali clean/dirty/unborn/conflitto,
immutabilità checkout/index/refs/config, inventario tracked/untracked/ignored,
root Maestro opachi interni al checkout, credenziali/build/link/FIFO/binari/UTF-8,
membership e limiti, ancestor sostituito e crescita controllata, nested repo e
gitlink, helper Git/script ostili senza esecuzione. Il percorso ordinario richiede
extractor confinato; le sole race deterministiche usano una porta sostituibile
con callback trusted nel test, senza autorizzare bypass da CLI/UI.
Checkbox riferita ai test definiti, non al PASS del confine T014.

## T014 — contesto confinato e sigillo privato,2026-11-17

Query inventory chiusa ls-files cached/others/exclude-standard nel runner Git
Xcode già qualificato, con preflight/recheck di configurazione e identità. Core
headless compone inventario/estrazione/rivalidazione; policy di esclusione pura
condivisa. Selettori vietati respinti prima di qualunque probe. Sorgenti regolari
UID coerente/nlink1/no-follow, root/ancestor/handle/fstat ricontrollati, UTF-8
rigoroso, nomi NFC e conteggio byte effettivi. Digest privato delle identità fra
i due passaggi impedisce sigilli misti anche con ancestor sostituito con byte
identici; il manifest persistito mantiene soltanto gli anchor previsti e hash.

Estrattore Node transitorio confinato, shell:false/env allowlist e lifeline FD
privato: perdita owner → uscita, nessun PID persistito usato per segnali. Il profilo
nega scritture persistenti/rete/fork e letture fuori scope o nei root privati.
Eccezioni di caricamento: directory /, sistema, binario Node, codice app e solo
package.json fidato; /dev/null non persistente. Nessun fallback non confinato.
Le race deterministiche usano la porta diretta soltanto in fixture; la composizione
ordinaria usa sempre il subprocess confinato. Frame JSON Foundation riusati, pagine
private raw8KiB/envelope32KiB, transfer massimo4MiB e numero frame bounded.

Limiti16selettori/200file/128KiBfile/1MiB corpus e30s rispettati nelle prove
locali, senza promessa generale di latenza. Il JSON corpus conservato è esso
stesso≤1MiB; escaping/metadata possono richiedere scope inferiore al totale raw.
Manifest e corpus sono pubblicati tramite T012 prima di SEALED: fallimento del
secondo publish lascia solo artefatti non autorevoli conteggiati. Nessun provider
o run viene avviato dal servizio contesto; wiring preview/CLI/UI resta futuro.

Le prove native hanno rilevato inizialmente un deny .env non efficace per escaping
del regex SBPL: corretto usando classe [.] e verificato prima di qualificare.
Primo gruppo39test:38PASS/1FAIL (nessuna promozione). Successivi gruppi comprendono
canary veri per letture .env/root auth/outside, scrittura, exec del proprio Node e
connessione a server loopback posseduto: tutti negati con controlli positivi.

Prima suite generale:450test,444PASS/1FAIL/5SKIP,178205,04ms. Fallimento nel teardown
di daemon-restart preesistente: stop con risposta client scaduta. Query successiva
dello stesso UUID conferma SUCCEEDED/STOPPED, senza kill o ricreazione dell’archivio
fixture preservato. Anticipando i deny espliciti si eliminano probe inutili, senza
cambiare deadline/test Foundation o runner. Ripetizione generale:451test,446PASS/
0FAIL/5SKIP G0 separati,141068,11ms. Nessun test pesante concorrente nella ripetizione.

Verifica finale dopo digest transitorio identità e cap framing: typecheck/lint/
build/build:test PASS,66/66test mirati PASS,22294,48ms. Comprendono20nuovi casi
contesto/Git,23contratti Git storici e21casi artefatti/quota, più2casi aggiunti
alla suite dopo la campagna generale (ancestor identico/framing). Corpus Unicode,
clean/dirty/conflitto/unborn, invariabilità index/refs/config/checkout, ignored/link/
FIFO/binary/credential, root Maestro interni, membership/crescita/TOCTOU, sigillo
parziale e lifeline sono coperti. Nessun segreto reale/login/modello o benchmark
lungo. Campioni002 rigenerati ripristinati; gate storici001/002/003 eG1 invariati.

## T015 — contratti API e offline inizialmente RED,2026-11-17

Dieci casi compilano:1PASS (grant core già applicato da T009 contro conferma UI
fittizia),9FAIL attesi perché validator/reader/inspect Discovery T016 mancano
ancora o il catalogo statico non include tutti i codici. Coprono DTO chiusi/cap
envelope/pagine/capability, admission separata da conclusione/approvazione,
operation pubblica senza intent/hash/path privati, cursori store/target/revisione,
pagine documento8KiB/hash dopo tampering, errori statici, schema3 non migrato e
letture offline LAST_KNOWN con eligibility sempre false/UNKNOWN anche con approval
storica. Fixture documento/approval riguardano storage, non verità semantica o
qualifica provider. Nessun client avvia sorgenti/modello per questi test.

## T016 — letture CLI/IPC, pagine e offline,2026-11-17

Implementati DTO/capability/errori statici, namespace read-only Discovery, dispatch
autenticato client-only, CLI e backend senza polling LLM, reader storico confinato
e pagine hash-validabili. Capability live espone soltanto gli otto metodi read
implementati; azioni future non vengono pubblicate. Provider.get mostra solo
configurazione pubblica e check=null, senza probe/login o falsa disponibilità.
Offline rimane LAST_KNOWN e eligibility=false/UNKNOWN anche con approval storica.
Schema3 viene rifiutato per Discovery senza migrazione o sidecar nuovi.

Cursori base64url chiusi store/target/revisione/offset; liste≤20 e cap effettivo
byte, chunk8KiB raw/base64 ed envelope finale≤32KiB. Manifest fonti letto e validato
nel reader nativo con pagina metadata bounded: non ricaricare un intero manifest
via centinaia di chunk/hash ripetuti. Nessun path oggetti/auth/host o intento/hash
privato nell’API. Reader readonly mantiene il profilo OS esistente senza permessi
nuovi; lookup oggetti da UUID registrati e owner/no-follow/hash, non input path.
Il profilo storico nega scritture/fork/rete: non si afferma un filtro kernel di
lettura per singolo UUID. Allowlist esplicita Discovery su host e child readonly.

Cinque tipi eventi metadata, watermark e riferimenti senza contenuti; tutti i
decoder desktop aggiornati insieme al catalogo SafeError. Pubblicazione nella
stessa transazione della modifica. Nessun nuovo stream token/carico prolungato.
Quota Discovery verificata nei suoi hook transazionali; eliminata la verifica
ridondante da ogni mutazione Foundation per mantenere indipendente il lifecycle.

Un test aggiuntivo ha osservato un difetto reale della serializzazione Buffer nel
reader JSON: byteLength perso e cursore finale scorretto. Caso prima RED (1FAIL),
corretto con DTO base64 esplicito su pipe nativa, decode/cap verificati nel proxy
e Uint8Array alla porta interna. La prova ora attraversa il vero reader confinato,
non soltanto il worker structured-clone. Fixture cursor cambiata da transizione
WAITING_USER→CANCELLING non valida a cancellazione terminale valida; invarianti e
soglie conservati.

PASS build/build:test/typecheck/lint e typecheck desktop.70/70test mirati PASS,
24496,73ms;29/29ulteriori API/quota/metadata PASS dopo isolamento hook budget.
Suite generale `caffeinate -i npm test`:466test,461PASS/0FAIL/5SKIP G0 separati,
150438,13ms. Desktop:28/28unit PASS,22/22integration PASS (30435,28ms). Dopo la
campagna generale rafforzati solo allowlist/envelope readonly:28/28API/offline/
artefatti e2/2pagine fonti su sigillo vero PASS sullo stato finale.

La CLI reale su daemon temporaneo legge capability/config/lista, poi gli stessi
dati offline dopo stop; repo importato invariato. Nessun modello o login avviato.
T017–T018 e le storie restano aperti; questo checkpoint non rende disponibile
una Discovery completa. Campioni002 rigenerati ripristinati; gate precedenti eG1
reale non promossi. Nessuna modifica al lockfile desktop preesistente non tracciato.

## T017 — test host/run inizialmente RED,2026-11-17

Quattordici casi compilano:13FAIL attesi per agent-runtime T018 assente;1PASS
(978,92ms totali). La prova già verde usa lo stesso profilo OS provider con probe
C nativo sintetico: lettura del run key e connessione AF_UNIX al controllo negati
EPERM/EACCES, con controlli non confinati riusciti. Nessun provider o account reale.

Test definiti per WAIT_GO e SPAWN_AUTHORIZED durevole, input/owner/gen/policy/cwd
chiusi prima degli effetti, replay senza duplicazione, lifeline prima/dopo GO,
SIGKILL host senza proof/slot mantenuto, proof falsificata e PID riutilizzato,
processo estraneo preservato, TERM/KILL sul solo handle posseduto e deadline.
Fixture Node come veri processi nello stesso runner, modulo launch sostituibile
soltanto tramite constructor trusted dei test; nessuna opzione equivalente wire.
Il provider fixture termina autonomamente nel caso host SIGKILL: il test richiede
comunque UNKNOWN e non prova che un provider reale termini senza un host vivo.
Teardown conserva il fixture se i processi non sono verificati assenti.
Checkbox attesta i test definiti, non una qualifica runtime già ottenuta.

## T018 — host Agent Runtime,2026-11-17

Implementati agent-host/runtime/proof dietro AgentRuntimePort e primitive
ProcessIdentity/LocalTransport esistenti. Intento processi prima del fork, host
WAIT_GO e HOST_READY persistito, autorizzazione SPAWN_AUTHORIZED riletta prima
di GO, poi provider PID/PROVIDER_RUNNING. Proprietario letto dall’operazione
ammessa con query UUID privata; non rebind a una nuova istanza. Nessun processo
Agent Runtime in managed_resources Foundation, nessun nuovo daemon/runner/SDK.

Host possiede l’handle provider; output raw8KiB/pagina,1MiBlinea/8MiBrun, stderr
64KiB drenato mai pubblico. Env/argv produzione chiusi e Native Codex qualificato;
fixture launcher soltanto seam di constructor trusted. Test senza seam rifiuta
il provider Node sintetico prima dell’esecuzione. Nessun provider reale invocato
dal runtime in questa qualifica. Le prove G0 separate usano solo backend locale.

Proof HMAC v1≤4KiB privata, fsync file+directory; assenza host da handle catturato
o ESRCH, mai dalla sola dichiarazione provider/PID persistito. Cancel TERM≤2s/
KILL solo handle vivo e deadline≤4s, perdita owner prima/dopo GO, drain senza
nuovi effetti. Cache compatta bounded libera ChildProcess/input conclusi; stop
dei processi posseduti funziona anche col writer chiuso. Proof mancante/corrotta,
gen errata, host morto con provider incerto e PID riutilizzato restano UNKNOWN
senza rilascio slot. Nessuna cancellazione remota dichiarata verificata.

Prima verifica18test dopo implementazione:18PASS. Un precedente gruppo15test
aveva14PASS/1FAIL nella fixture ignore-TERM: cancel partiva prima che lo script
installasse il proprio handler/marker. Fixture ora segnala readiness dopo il
handler; il caso attende readiness e richiede espressamente SIGKILL nella proof,
senza allungare i4s. Ultimo gruppo runtime/launcher21/21PASS,13199,10ms. Copre
anche writer indisponibile, authority owner, fase GO, replay, proof e PID estranei.
PASS typecheck/lint/build/build:test. G0 esplicito8/8PASS (1884,19ms), nessuna
qualifica auth/modello reale.

Suite generale `caffeinate -i npm test`:484test,479PASS/0FAIL/5SKIP G0 separati,
89783,87ms osservati. Nessuna modifica alle soglie Foundation o campagne di
volume/durata. Campioni002 rigenerati ripristinati ai byte originali.

Checkpoint Foundation004 completato per primitive interne: le storie US1–US4,
composizione funzionale avvio/intervista/review e recovery daemon T033/G2 restano
da realizzare. I test di owner loss qui usano veri host/provider fixture e perdita
dell’IPC; non sostituiscono il futuro SIGKILL del daemon completo. Proof outcome
locale non equivale a documento valido o approvato. Gate001/002/003 eG1 invariati.

## T019 — avvio US1 inizialmente RED,2026-11-17

Quattordici casi compilano e falliscono come atteso per operations US1 ancora
assente (14FAIL,67,62ms). Provider/auth/capability, scope owner/store/modello/
revisioni, grant assente/scaduto, nessun run da preview/check/prepare, risposta
immediata mentre il fingerprint è pendente (grant ancora inutilizzato), UUID
confliggenti, retry identico, richieste distinte concorrenti senza coda e risposta
persa prima/dopo accettazione. Identità/run/slot/grant devono essere durevoli
prima del callback di lancio. Repo Git reali dirty/conflict/unborn restano invariati.

Il callback di lancio qui è una porta fixture che conta gli effetti, non una
prova provider o daemon end-to-end. Il precedente T018 copre i veri processi
locali. Le fixture di US1 usano snapshot/file reali e provider simulato; nessuna
credenziale o chiamata modello. La checkbox riguarda i test definiti, non l’avvio
funzionale già completato. La suite completa rimane intenzionalmente RED finché
T020–T022 non soddisfano i relativi contratti.


## T020 — configurazione e check provider,2026-11-17

Implementati capabilities Codex e operazioni configure/check, senza inferenza.
Pin nativo/hash/versione/modello espliciti; asset profilo/schema confrontati con
le evidenze G0. Il launcher conserva il controllo hash immediatamente prima del
run. Lo stato login accetta soltanto la risposta ufficiale ChatGPT prevista:
exit0 da solo, API key, output malformato, Keychain o managed policy incompatibili
restano bloccanti. checkedAt è rilevato al termine del controllo; nessuna promessa
su accesso modello, quota, account o cancellazione remota.

Probe locale breve con helper Foundation transitorio e IPC owner-bound, non un
nuovo servizio persistente o test runner. Env chiuso, stesso profilo G0 con rete
ulteriormente negata, stdout/stderr aggregati8KiB e mai pubblicati. Il figlio
possiede solo il proprio handle nativo, timeout3s, perdita owner→KILL dell’handle
vivo e attesa close. Intento risorsa prima del fork; prova insufficiente mantiene
UNKNOWN/BLOCKED e conserva scratch. Composizione daemon/drain resta T027/T033.

Configurazione esplicita crea soltanto home0700/installation_id UUID0600 con
fsync. auth.json è verificato soltanto via metadata e causa rifiuto; nessuna
lettura/copia token, login o fallback. Grant verificato prima del provisioning,
poi consumo/CAS configurazione/esito nella stessa transazione. Retry originale
non ripete il provisioning; CAS concorrente preserva il grant perdente. Query
privata grant aggiunta al reader metadata, senza esporre una nuova API pubblica.

11/11 test dedicati PASS (636,01ms), inclusa prova nativa esplicita G0 del solo
login status su CODEX_HOME temporanea senza credenziali. Nell’ambiente isolato
osservato la CLI segnala default Keychain non disponibile: normalizzato UNSAFE,
mai AVAILABLE. La prova accetta AUTH_REQUIRED oppure blocco UNSAFE secondo lo
store OS, verifica risorsa Foundation RELEASED/ABSENT e assenza file token.
Non qualifica il login reale G1, che resta NOT_RUN.

Regressioni dominio/API/metadata/artefatti/quota:49/49PASS,
2933,04ms. Typecheck/lint/build/build:test PASS. Due primi test fixture hanno
rilevato path temporanei non canonicalizzati, corretti con realpath; una prima
aspettativa AUTH_REQUIRED è stata corretta perché il Keychain può risultare
inaccessibile nel profilo confinato e deve bloccare, non simulare credenziali.
I test T019 restano RED per prepare/start/preview ancora da implementare inT021;
nessuna suite completa dichiarata PASS in questo incremento.

Fonti: [autenticazione ufficiale](https://learn.chatgpt.com/docs/auth),
[login status](https://learn.chatgpt.com/docs/developer-commands?surface=cli).
Help locale del pin verificato con HOME/CODEX_HOME vuoti, senza status account.


## T021 — prepare, preview e admission asincrona,2026-11-17

Grant monouso con summary di selettori, omissioni, byte, provider/modello e invio
esterno, bindato all’intent canonico owner/store/revisioni/snapshot/digest.
Summary e intent insieme rispettano envelope32KiB prima di salvare il grant.
Manifest/corpus caricati soltanto da oggetti registrati/hash-validati, verificati
anche reciprocamente e serializzati≤2MiB; nessuna nuova lettura sorgenti per
costruire il payload dopo il consenso.

Start riserva l’UUID e restituisce admission senza attendere contesto o modello.
Durante la rivalidazione il grant rimane inutilizzato, senza run o processi.
Il writer conserva una sola riserva pendente, senza coda. ACTIVATE ricontrolla
owner/istanza/intent/grant, provider corrente, progetto e snapshot e committa
consumo/Discovery/run/slot/pin/esito insieme, prima del callback launch. Nessuna
colonna o migrazione schema4 nuova; pendingGrantId è JSON privato eliminato dal
reader pubblico. Doppio UUID identico non avvia un altro job; altro UUID riceve
BUSY. Errore prima dell’attivazione lascia grant inutilizzato; perdita risposta
dopo admission restituisce UNKNOWN_OUTCOME e si risolve sull’UUID originale.

Preparazione start bounded30s con abort della lettura confinata; input è il
corpus sigillato. Un cambio provider durante la rivalidazione blocca via CAS
SQLite; non si promette atomicità fra filesystem e database. Preview asincrone
includono quelle pendenti nel cap4 prima di avviare lettori. Preview/check sono
idempotenti anche dopo variazioni successive dei prerequisiti, senza inferenza.

Suite generale caffeinate -i npm test:512test,506PASS/0FAIL/6SKIP G0 separati,
104073,98ms. Include i veri file schema-upgrade/admission-store, dominio, API,
writer e regressioni001/002. Corretto l’elenco T020: il precedente comando
focalizzato ignorava nomi file inesistenti e non aveva eseguito schema/ledger;
i49 casi effettivi riguardavano dominio/API/metadata/artefatti/quota.

Ultimo affinamento UNKNOWN_OUTCOME dopo la suite generale: typecheck/lint/
build:test e31/31test mirati PASS,17544,69ms (avvio/config/schema/admission).
I17casi launch/start coprono ora anche CAS provider durante la verifica, corpus
incoerente, riserva privata non pubblicata e limite anteprime pendenti. Una
prima compilazione del controllo envelope aveva una graffa in eccesso, corretta
prima di eseguire i test. Campioni002 ripristinati ai byte originali.

Il launch è ancora una porta fixture che conta gli effetti: T022 collegherà
l’adapter/parser al runtime. Queste prove non qualificano un account reale né
il percorso UI/daemon completo T027/T033. Recovery delle riserve dopo crash
resta T033, senza auto-resume; G1 e gate precedenti restano aperti.


## T022 — adapter, parser e collegamento runtime,2026-11-17

Adapter Codex con input portabile chiuso, istruzioni trusted, hash/sourceId e
limiti200fonti/128KiBfile/1MiBcorpus/2MiBinput; budget byte inferiore impostabile
soltanto nel constructor trusted. Gli errori di contesto/modello nativi sono
normalizzati, senza troncamento o stime presentate come token misurati. Modello
non riconosciuto/fallback metadata è UNSUPPORTED, non una capacità presunta.
Argv/env e profilo G0 già qualificati vengono riusati senza nuovi flag o SDK.

Decoder per-run NDJSON UTF-8 incrementale,1MiBlinea/8MiBrun; oggetti QUESTIONS/
DOCUMENT chiusi e bounded, sezioni obbligatorie, claim≤200totali, documenti≤256KiB.
Eventi/tool inattesi, malformati, duplicati, dati dopo turn.completed, JSON
troncato e completamento mancante invalidano il risultato. exit0 da solo non
basta. Quote/risposte hanno qui verifica strutturale: provenance rimane T039.
Nessun RESULT prima della verifica dell’uscita; stderr resta privato nel host.
Record validi prima di un errore nello stesso chunk restano output parziale.

Core launcher controlla admission/run/input prima degli effetti; OS port prepara
runtime0700/schema0600 esclusiva e fsync, senza sovrascrivere directory esistenti.
Host WAIT_GO→HOST_READY durevole→SPAWN_AUTHORIZED durevole→GO. Solo proof runtime
riconfermata e parsing valido permettono onResult; errori noti finalizzano con
esito safe, nessuna approvazione. Process intent preesistente non è adottato o
terminato e mantiene lo slot; nessuna falsa assenza derivata dal PID. Fallimento
prima di chiamare AgentRuntime è distinta assenza di processi per control flow.
Pubblicazione/intervista/review e output durevole restano callback core T031/
T032/T039, non implementazioni surrogate; bootstrap completo resta T027.

I test con veri host/provider Node locali hanno trovato che Node può omettere
close dopo disconnect IPC: finalizzazione runtime ora osserva anche exit del
proprio handle, attende la coda e richiede sempre proof autenticata. SIGKILL/
prova assente non diventano assenza provider. Corretto anche il mantenimento del
prefisso valido nello stesso chunk contenente UTF-8/tool/errori non validi.
Teardown dei nuovi fixture conserva archivio/runtime se l’uscita non è provata.

Sette test iniziali RED (0/7PASS,66,95ms); dopo implementazione33/33test mirati
PASS,13400,77ms, poi aggiunto caso intent processi preesistente nella suite.
Typecheck/lint/build/build:test PASS. Suite generale caffeinate -i npm test:
528test,522PASS/0FAIL/6SKIP separati,100268,51ms. Include8contratti decoder/adapter,
8integrazioni launcher e regressioni runtime/001/002. Campioni002 ripristinati.

G0 esplicito8/8PASS,1997,60ms. Nel vero stream del modello sintetico si osserva
un item.error per metadata modello assente, seguito da QUESTIONS e exit0: il
nuovo parser lo rifiuta correttamente come UNSUPPORTED. G0 qualifica isolamento,
non modello/account/inferenza reali. Nessun cambio al profilo per ottenere PASS;
G1 e gate precedenti aperti. Fonti formato JSONL: [documentazione ufficiale](https://learn.chatgpt.com/docs/non-interactive-mode) e osservazione locale del
pin con backend esclusivamente loopback/sintetico, senza account utente.


## T023 — CLI admission e UUID originale,2026-11-17

CLI provider configure/check, preview/show/discard, prepare/start e operation;
DTO chiusi nel protocollo e LocalClient. Scope/intent JSON letti soltanto dalla
CLI fidata:32KiB, UTF-8, file regolari/no-follow/nonblocking, stabilità fstat;
path dei file non inviati al core. Flag non pertinenti/prompt/argv vietati.
Versioni attese esplicite per preview/check; start/configure risolvono l’intent
dal grant nel core e confrontano target o binario/modello, senza persistere
intent/provider-path replayabili nelle future ricevute. Discard conserva oggetti
conteggiati come orfani e nega snapshot referenziati/pinned.

LocalClient congela il DTO JSON e conserva UUID prima del possibile invio.
Ritorna admission≤2s senza polling del modello. Risposta persa/errore storage
incerto: al più una query discovery.operation.get sullo stesso UUID; NOT_FOUND
non prova non-invio e non permette un nuovo start. Ricevuta di altra azione o
UUID non diventa successo. Reiezione busy certa non viene interrogata a ciclo.
Backend non esegue mutate/prepare offline e non fa autostart/fallback registry;
lo storico e l’idoneità offline false/UNKNOWN restano disponibili. Human output
include UUID anche su errore incerto.

Otto casi CLI/client, compresi veri subprocess CLI e IPC autenticato contro
porte core fixture: scope→prepare→start→UUID originale, retry senza doppio run,
check senza inferenza, configure senza grant negato, discard metadata, FIFO/
oversize/flag impropri senza invio. Il transport fixture compone i servizi core
ma non è il daemon di produzione: T027 resta il gate di bootstrap/mutazioni
registrate. Il daemon attuale continua ad annunciare soltanto i metodi read
implementati; nessuna capability funzionale simulata.

Quattro casi iniziali RED per client ancora read-only; primo gruppo CLI7/7PASS,
3915,94ms, poi8casi con il controllo azione originale. Prima suite generale:
535test,528PASS/1FAIL/6SKIP,101256,86ms; il nuovo filtro reader aveva escluso
l’eccezione eligibility offline. Corretto il filtro mantenendo il rifiuto delle
mutazioni, confermati12/12casi CLI/offline,4179,58ms. Suite finale caffeinate -i
npm test:536test,530PASS/0FAIL/6SKIP,102479,71ms. Typecheck/lint/build/build:test
PASS; campioni002 ripristinati ai byte originali. Nessuna chiamata modello o
account reale, G1 e gate precedenti invariati.


## T024 — contratti desktop inizialmente RED,2026-11-17

Definiti8casi bridge/ricevute: API nominate/DTO32KiB, niente path/argv/token dal
renderer, controlli sender/main-frame/origine, picker opaco bindato a owner/
epoch/TTL, namespace CLI e risposta Discovery dedicati; ricevuta privata prima
dell’effetto, admission non terminale, cancel/expiry/owner/epoch invalidi senza
mutazione, query originale dopo risposta persa senza fallback project, BLOCKED
terminale e wrong-store/action UNKNOWN. Fixture CorePort e profilo/provider
sintetici, senza lettura o esecuzione del binario né Keychain/account.

Typecheck desktop PASS. Gli8test sono RED come atteso (0PASS/8FAIL,121,73ms):
Main Discovery, named schemas e namespace ricevute da implementare inT025.
Una prima compilazione aveva un cast su riga separata non valido, corretto.

Due scenari Electron E2E definiti e riconosciuti da Playwright --list, non ancora
eseguiti: ingresso senza provider (nessuna sessione inventata) e anteprima locale
intenzionale/cancellabile con gate invio ancora chiuso, repo invariato. Questi
casi locali non accedono a provider/auth reali; il percorso UI con modello reale
rimane G1 opt-in T028. UI/T026 e bootstrap/T027 restano prerequisiti per queste
prove end-to-end. Checkbox T024 attesta test definiti, non UI già funzionante.


## T025 — bridge e ricevute Discovery, 2026-11-17

API nominate condivise con preload, allowlist CLI separata, input scope/intent
via stdin UTF-8 bounded32KiB: nessun file temporaneo replayabile. Picker nativo
restituisce handle opaco owner/frame/epoch/TTL, percorso soltanto nel main.
Conferma UI monouso60s distinta dal grant core5min, confronto intent canonico
e preflight capability/configurazione; cambio owner durante preflight bloccato.
Ricevute Discovery private nello store esistente, soli metadata4KiB/max100,
prima dell'invio. Admission resta RECONCILING; esito modello separato. Recovery
interroga soltanto UUID e namespace originali, senza replay/fallback registry.
Store ID assente/diverso e azione diversa restano UNKNOWN; BLOCKED certo è
terminale. Errori statici e decoder chiuso escludono stderr/token/path provider.

Gli8casi T024 ora PASS, più isolamento namespace conferme e due casi di
regressione osservati RED prima della correzione (store ID assente e owner
cambiato durante preflight). Suite desktop unit/contract33PASS; integrazione
desktop28PASS/0FAIL/0SKIP,21814,85ms. Ulteriore test subprocess pipe1PASS
con CLI fixture e vera CLI offline (STATE_ABSENT e UUID originale, nessun
avvio implicito). Prima aspettativa DAEMON_UNAVAILABLE corretta in STATE_ABSENT
per archivio non inizializzato. Build core/desktop, typecheck desktop e lint
PASS. Nessun provider/account reale o benchmark lungo; UI/T026 e composizione
mutazioni/T027 restano da completare. G1 e gate preesistenti invariati.


## T026 — pannello di avvio desktop, 2026-11-17

Dettaglio progetto → Discovery, mantenendo il linguaggio visivo003. Provider e
modello configurati intenzionalmente tramite picker opaco; check/login separato
e istruzioni per il profilo ufficiale Keychain. Nessuna installazione, lettura
credenziali o polling di login. Scope relativo≤16, preview locale, fonti a pagine,
copertura/omissioni/byte/digest/scadenza. Consenso checkbox distinto dalla conferma
monouso; riepilogo progetto/snapshot/digest/provider/modello prima dell'invio.
Anteprima scaduta, configurazione cambiata, servizio offline o provider non
verificato mantengono Avvia disabilitato. Richiesta accettata distinta da analisi
completata, UUID mostrato; polling solo operation originale≤1/s, visibile e senza
sovrapposizione. Esito incerto rinvia a Operazioni, senza reinvio automatico.
Vista rimontata su epoch/progetto/config, callback dopo unmount scartate.

Typecheck e build desktop PASS. Test unitario ambito/gate1PASS; suite desktop
unit/contract34PASS prima dell'ulteriore controllo fase/outcome T027. Due E2E
Electron con vero daemon/CLI2PASS,7,9s: provider assente senza sessione inventata;
ambito traversal rifiutato, preview soltanto su azione esplicita, Esc annulla e
restituisce il focus, fonti visibili dopo conferma, gate invio chiuso e snapshot
repository identico. Prove eseguite insieme alla composizione T027 in working
tree; nessun provider/account reale. Prima esecuzione anticipata senza bundle
aggiornato fallita per pulsante Discovery assente; ricompilazione e prove finali
PASS. Nessuna nuova libreria grafica/runtime. US2/output/intervista e US3/review
restano incrementi successivi; i due E2E non qualificano G1.


## T027 — composizione daemon/headless e bootstrap, 2026-11-17

Composti provider Codex e inspection, estrattore confinato, artefatti sul writer
esistente, host Agent Runtime, launcher e servizi admission nel daemon unico.
Le sostituzioni sono soltanto CoreDependencies fidate, mai DTO pubblici. Status
annuncia metodi effettivamente instradati; get provider non controlla login né
modello. Configurazione/check/preview/discard/prepare/start mantengono UUID e
controlli core. Nessun autostart, login, installazione, upgrade da lettura o
import Electron nel core. Registry/storico restano interrogabili con provider
UNSAFE o admission Discovery bloccata.

Prima barriera runtime su recover/drain/storage failure. Reconcile usa soltanto
prove Agent Runtime; assenza non provata conserva identità/slot e RECONCILING,
nessun kill da PID. Stop con deadline esistente attende job accettati e drena
runtime separatamente dalla Foundation; incertezza non prepara uno shutdown
fittizio. Schema storico senza Discovery mantiene lo stop Foundation senza
inizializzare agenti. T033 conserva la responsabilità per recovery completa,
finestre crash e cancel pubblico; questi controlli iniziali non attestano G2.

La pubblicazione domande/documenti è ancora il gate di US2/US3: il callback
produzione rifiuta un risultato parsato con PROVIDER_UNSUPPORTED dopo prova
d'uscita, senza inventare WAITING_USER/READY_FOR_REVIEW o approvazioni. Le porte
di pubblicazione sono sostituibili nei test e verranno collegate a T031/T039.
Non qualificato un flusso utile completo e nessun run reale eseguito.

Il nuovo test production-bootstrap era RED sul vecchio bundle read-only. La
prima composizione ha esposto CONTEXT_UNSTABLE in headless: il percorso package
JSON assumeva la profondità dist-tests/src e nel dist reale Node tentava di
leggere package.json fuori dal codice autorizzato. Riprodotto con soli dati
sintetici; build-assets ora emette metadati ESM nel root di codice per entrambe
le build. Profilo OS invariato, nessun ampliamento di permessi. Bootstrap e
contesto/offline21PASS dopo fix. Due test successivi hanno esposto ERROR al
posto di BLOCKED per admission fenced: corretto mapping; DISCOVERY_BUSY resta
BUSY distinto. Decoder desktop rifiuta phase/outcome contraddittori.

Verifiche finali su macOS26.3.1 arm64, Node26.13.0, Electron45.3.0:
- Build/typecheck core e desktop e lint architetturale PASS.
- Discovery unit/contract/integration + bootstrap/lifecycle daemon/controller +
  readonly selezionati:191test,185PASS/0FAIL/6SKIP,35862,13ms. I6SKIP sono
  opt-in G0 separati, non promossi a PASS e non nuove qualifiche G1.
- Bootstrap dedicato:5PASS/0FAIL/0SKIP,6674,54ms (preview vero CLI/daemon senza provider e repo
  invariato/offline; letture senza probe e check UNSAFE intenzionale; identità
  UNKNOWN preservata e stop negato; stop store storico senza agenti; start con
  porte sintetiche dopo admission durevole, replay UUID senza secondo launch
  e drain verificato dalla porta fixture). Quest’ultimo caso non crea processi
  provider reali e non sostituisce le prove host locali T018/T022 o G1.
- Desktop unit/contract35PASS/0FAIL/0SKIP,3684,20ms.
- Desktop integrazione29PASS/0FAIL/0SKIP,29231,95ms.
- Electron Discovery E2E2PASS/0FAIL,7,9s, inclusi tastiera/focus/errore scope.

Nessuna acceptance completa, benchmark, inferenza/account/provider reale o
nuova campagna prolungata. G0 precedente invariato, G1/T028 NOT_RUN; gate
001/T082,001/T085,002/T093 e review umana003/T054 conservati.


## T029 — contratti intervista inizialmente RED, 2026-11-17

Sei test core definiti con corpus reale scratch e provider/launch fixture: domande
durevoli assegnate dal core, WAITING_USER senza processi e slot occupato; risposta
prima del nuovo run, sessione/snapshot conservati, replay UUID senza duplicazione
e payload diverso negato; UNKNOWN e correzioni append-only; risposta conservata
anche se il contesto cambia prima della nuova esecuzione; grant/revisioni/cap4KiB
e20turni; cap20domande senza troncamenti. Reader offline interroga la domanda
originale. Nessun provider/account reale. Build:test PASS;6test RED come atteso
(0PASS/6FAIL,9253,34ms): publishQuestions/answer non ancora implementati (T031).
T028/G1 reale rimane NOT_RUN; dipendenze locali US2 ammesse dal piano.


## T030 — contratti output/eventi inizialmente RED, 2026-11-17

Quattro casi: UTF-8 e chunk raw8KiB/envelope32KiB, cursori scoped e watermark;
generazione estranea/uscita impediscono pubblicazione; overflow4MiB con
troncamento visibile senza nuovo file; fault tra artefatto e metadata/outbox
lascia solo oggetto non autorevole, nessun watermark/evento falso e nessun
contenuto nel journal. Il limite4MiB usa indice sintetico512righe sullo stesso
oggetto privato, non una campagna di volume/processi/durata. Build:test PASS;
4test RED attesi (0PASS/4FAIL,4909,24ms): publisher output da implementareT032.


## T031 — intervista durevole e continuazione intenzionale, 2026-11-17

Implementata pubblicazione QUESTIONS solo dopo EXIT_OBSERVED/SUCCEEDED e
processo assente/rilasciato; ID assegnati dal core, max20domande/4KiB e slot
conservato in WAITING_USER. Risposte ANSWER/UNKNOWN e correzioni append-only
con grant/CAS e UUID; PREPARE salva risposta e consuma grant atomicamente prima
della rivalidazione, ACTIVATE crea un solo run successivo dopo controllo
contesto/config/provider. Stessa sessione/snapshot e storia portabile con
domande+risposte; niente resume o permessi ulteriori. Risposta conservata su
contesto cambiato, che diventa STALE senza un nuovo run. UNKNOWN fingerprint
produce CONTEXT_UNSTABLE, non cambiamento dato per provato.

Sette test intervista PASS, compresa composizione produzione con veri host e
provider fixture locali, uscita provata e domanda durevole senza processo in
attesa. Controllati corpus identico nel secondo input, correzioni, replay,
grant/stato/cap4KiB/20turni/20domande e reader offline. Insieme a regressioni
metadata/ledger/adapter:28PASS/0FAIL/0SKIP,12987,14ms. Prima compilazione ha
segnalato nullability nella paginazione generica, corretta con check esplicito.
Build:test/typecheck/lint PASS. DOCUMENT/review restano US3, G1 reale NOT_RUN.


## T032 — pubblicazione output normalizzato, 2026-11-17

Publisher collegato al vero percorso host/decoder, accetta soltanto PROGRESS e
AGENT_TEXT normalizzati. UTF-8 rigoroso e chunk≤8KiB senza spezzare caratteri;
artefatto privato pubblicato prima di indice/watermark/outbox atomici. Letture
core/CLI/offline preesistenti restituiscono solo chunk registrati e hash-validi,
con cursori scoped/envelope32KiB. Nessun token, corpo modello o raw stderr nel
journal; metadata Discovery includono identità e watermark e sono accettati
dal decoder desktop003 esistente. Generazioni estranee e dati dopo uscita
rifiutati prima di allocare. Coda interna limitata, nessun nuovo stream pubblico.

Cap conservazione4MiB, overflow segna l'ultimo chunk truncated usando metadata
terminali senza altro file; il launcher conserva l'errore senza falso successo.
Fault prima del commit conserva l'oggetto non autorevole contato, senza evento
o watermark falsi. Il primo seed del test limite riusava un artifactId e ha
fallito UNIQUE: corretto con512oggetti fixture distinti/4MiB, preparati in blocco
senza carico eventi o run prolungato (la descrizione T030 era preliminare).

Quattro test output/eventi PASS; insieme a intervista, API e host/provider-launch
fixture28PASS/0FAIL/0SKIP,17777,05ms. Inclusa compatibilità evento truncated con
preload/renderer e assenza di redazioni spurie; prima selezione11PASS. Build
core/test e typecheck PASS; nessun provider/account reale, G1 NOT_RUN invariato.


## T033 — recovery e cancellazione locale verificata, 2026-11-17

Separati recovery/lifecycle Agent Runtime. Startup enumera soltanto metadata
bounded: intento SPAWN_INTENT senza record processo non viene avviato; diventa
INTERRUPTED/FINALIZED. Prove autenticate di uscita o release/assenza già durevoli
permettono finalizzazione; identità non provata conserva processo/slot e
RECONCILING. WAITING_USER, output e domande non vengono cancellati o ripresi.
Operazioni accettate prima del crash restano interrogabili e vengono interrotte
senza replay; risposta già confermata conservata.

Cancel usa grant distinto, CAS e transazione writer: WAITING_USER termina senza
processo, RUNNING passa CANCELLING e aspetta prova locale≤4s. Esito incerto resta
WORKING/UNKNOWN e può essere riconciliato, senza terminale fittizio. Risultati
tardivi dopo cancel/reconcile non pubblicano domande. Stop drena nel deadline
core esistente e non confonde cessazione locale e remota. Query/cancel intent
restano disponibili con admission bloccata per proprietà runtime incerta.

Tre casi iniziali RED (0PASS/3FAIL,5829,19ms); ora4test recovery PASS, inclusi
veri host/provider fixture per cancel RUNNING/WAITING_USER e riapertura con
risposta accettata ma continuazione non partita. Selezione recovery/bootstrap/
metadata/provider-launch27PASS/0FAIL/0SKIP,14003,31ms. Caso bootstrap con PID
estraneo/UNKNOWN preservato ancora PASS. Compilazione iniziale con inferenza
stringa dell'outcome corretta annotando DiscoveryRun. Typecheck/lint PASS.
La qualifica completa SIGKILL daemon/host e UI rimane T036/G2; nessun account
o modello reale, G1 e gate preesistenti invariati.
