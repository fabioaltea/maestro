# Contract — ProviderPort e AgentRuntime004

## Provider-neutral ports

`ProviderPort`: inspectConfiguredBinary, checkAvailability, buildInvocation, decodeEvent/finalResult. Input `runId/generation`, profile/model, corpus autorizzato, schema e istruzioni Project Architect trusted; output normalizzato PROGRESS/QUESTIONS/DOCUMENT/FAILED/USAGE facoltativo. Nessun tipo Codex nel dominio.

Capabilities primo adapter: readOnlyAnalysis=true soltanto dopo qualifica, portableTurns=true, nativeResume=false, localCancellation=true, verifiedRemoteCancellation=false, quotaResetInfo=false salvo prova. Availability con checkedAt e causa NOT_CONFIGURED/AUTH_REQUIRED/UNSUPPORTED/UNSAFE/AVAILABLE; dato cached non autorizza un avvio. Modello identificato esplicitamente dalla configurazione utente e qualificato nel flusso reale, nessun modello/account dato per disponibile.

## Profilo Codex pin

Primo profilo0.167.0 native arm64, hash esatto in research. Path configurato, realpath/hash/version ricontrollati prima di invocare. argv shell:false, eseguibile nativo (non wrapper npm), stdin con envelope trusted+corpus/risposte; il prompt non è un argomento shell. Schema fidato copiato nel runtime privato, mai nell’archivio letto dal provider.

Argomenti base osservati/documentati:

```text
<binary> --no-daemon exec --json --ephemeral --skip-git-repo-check
  --ignore-user-config --ignore-rules --sandbox read-only
  --output-schema <runtime/schema.json> --model <configured-model> -
```

Override `-c key=value` da costanti del profilo, non dal client: cli_auth_credentials_store="keyring", web_search="disabled", project_doc_max_bytes=0; features.shell_tool/view_image/multi_agent/goals/hooks/apps/remote_plugin=false, agents.enabled=false, features.code_mode.enabled=false, apps._default.enabled=false, plugins._default.enabled=false, skills.bundled.enabled=false, skills.include_instructions=false, MCP vuoto e nessun update automatico. Il gate verifica che la build riconosca il profilo, senza flag inventati per apply_patch. Eventuali opzioni incompatibili devono fallire, non essere ignorate.

HOME/XDG/TMP per-run privati, CODEX_HOME dedicato e stabile per utente; ambiente allowlist senza NODE_OPTIONS/DYLD/GIT_*/shell injection/API key/session token. Endpoint provider ufficiali della CLI, niente baseURL arbitrari in produzione. API key/endpoint locale sintetici soltanto in fixture test isolate, mai raggiungibili da renderer o configurazione produzione.

## Keychain e permessi effettivi

Login ufficiale manuale nel CODEX_HOME dedicato e keyring-only. Maestro non interroga Keychain per ottenere il token e non lo copia: legge soltanto stato normalizzato prodotto dalla CLI. No auth.json, fallback auto, credential helper o riuso presunto di login di un’altra home. Config managed incompatibile → blocco; nessuna policy aziendale modificata o bypassata.

Profilo OS provider deny-by-default, distinto dal Git inspector: letture soltanto di binario/librerie OS necessarie, schema/istruzioni trusted e runtime non sensibile; API Keychain necessarie esplicitamente qualificate. Nega i file di credenziali, home utente, checkout, archivio Maestro, filesystem esterni e exec di altri programmi. Sorgenti soltanto su stdin. Scratch scrivibile è esclusivamente per-run e non contiene token. Non confondere read-only interna CLI con questo confine.

**apply_patch e altri tool residui**: non si assume che scompaiano. G0 deve dimostrare che un tentativo di lettura di dati protetti, scrittura al checkout/dati protetti o esecuzione non autorizzata non ottenga dati né effetti prima del rifiuto OS. Strumenti hosted/MCP/app/web o altri canali non confinabili sono incompatibili: provider UNSAFE. Una toolcall inattesa invalida il risultato e richiede cessazione controllata; l’osservazione dell’evento non è il controllo preventivo di sicurezza.

G0: vero binario e fixture inferenza locale sintetica, catalogo reale, tentativi ostili su auth.json/Keychain-file/archivio/checkout/symlink/exec/config; niente credenziali reali. G1: login Keychain/provider reali su fixture autorizzata; prova accesso, refresh se osservabile, nessun file token prodotto e nessun dato escluso nei payload. Se l’outer sandbox impedisce la prova, NOT_RUN/BLOCKED, non profilo permissivo.

## Parser e risultato

NDJSON UTF-8 incrementale rigoroso, linea≤1MiB, totale≤8MiB/run e stderr≤64KiB (mai esposto). Eventi consentiti dalla build pin mappati in DTO neutri; messaggi liberi trattati come testo inerte. Exit0 non prova successo: serve final result conforme allo schema, hash/contesto e cessazione verificata. Malformato/overflow/timeout/error/quota → safe code, output utile parziale e nessuna bozza approvabile.

Il final result è QUESTIONS oppure DOCUMENT, chiavi chiuse. Nessuna esecuzione di comandi proposti nel testo, apertura URL, installazione skill o richiesta di permessi implementata da output. Intervista: ogni risposta crea intenzionalmente un run nuovo con materiale locale persistito; non chiamarlo resume nativo Codex.

## Host per-run e ownership

AgentRuntimePort: launch, observe, cancel, reconcile, stopWithin(deadline). Host Node transitorio posseduto dal core, non daemon prodotto. Key/endpoint/gen privati del run; usa l’attuale transport challenge con identità run, senza ampliare il permesso dei client pubblici. provider non può leggere credentialRef dell’host.

Sequenza: ledger/grant/slot/SPAWN_INTENT durevoli → spawn host in WAIT_GO → handshake con hostPid/gen, DB HOST_READY → DB SPAWN_AUTHORIZED → messaggio GO → spawn provider confinato → handle/PID osservati → risultato/exit proof → finalizzazione. Perdita owner prima di GO: nessuna chiamata modello; dopo GO: cancel-on-owner-loss-v1 chiude soltanto handle vivo del provider.

Host conserva exit proof minima autenticata dal run key (IDs/generation/esito locale, senza output segreto), fsync prima di terminare se il daemon non risponde. Core usa challenge del vivo o prova autenticata più assenza host/handle; non inferisce assenza del provider dal solo PID host morto. Prova mancante, PID riutilizzato o generation mismatch → UNKNOWN/RECONCILING. Nessuna scansione o killpg; nessun segnale a PID da DB.

Cancel: SIGTERM al proprio handle, grace2s, SIGKILL solo se ancora posseduto; budget4s complessivo e deadline di stop esistente. Se uscita non provabile, retain slot e stato incerto. Il provider potrebbe aver avviato inferenza remota: non dichiarare cancellazione remota verificata. Su riavvio niente ripresa automatica; l’utente può continuare soltanto dopo riconciliazione e consenso ancora valido, con nuovo run.

ManagedResource Foundation rimane intatto: discovery_processes separato, policy Agent Runtime dichiarata e sostituibile. WAITING_USER persiste senza host/provider, ma conserva lo slot logico.

### Evidenze di qualifica e isolamento di autenticazione

G0 non deve dimostrare l’impossibile rimozione di ogni tool: deve certificare la
policy effettiva del pin contro i canali rimasti. Runtime scratch può essere scritto
dalla CLI per cache tecnica non sensibile, ma sorgenti/archivio/credential-file non
sono leggibili o scrivibili dal provider. Keychain via API OS è un’eccezione di
autenticazione fidata, non una capacità offerta al modello: se la superficie
strumenti può interrogarla o i requisiti managed impongono accessi non confinabili,
profilo UNSAFE. Non usare un account, un token o un endpoint diverso in produzione
per far passare i test. I rapporti reali/sintetici dichiarano le differenze di backend.
