# Qualifica provider004

## G0 — PASS sintetico,2026-11-16

**Comando**: `npm run test:discovery:boundary`. Node runner esistente, guard
MAESTRO_DISCOVERY_G0=1;8PASS/0FAIL/0SKIP,2335,59ms nella prova T003.
Piattaforma macOS26.3.1(a), build25D771280a, arm64/APFS, Node26.13.0.

| Elemento | Valore |
|---|---|
| Codex native CLI |0.167.0 |
| SHA256 binario |`030316ecfbb41f4e7946e584b0063ef333b7a36cd312ba349f2f6869e39b62cc` |
| Policy |codex-discovery-macos-v1 |
| SHA256 provider.sb |`ccc59b0561c53c6aeef50327c7bf13dac6f331c11ecee60e5a4601eccd5f8cf6` |
| SHA256 schema |`b8ed8108f43a36fa6445405f6516107e3c6c50ef4ee86393dc4d5cca01fcb74b` |
| Modello/backend |maestro-fixture, Responses HTTP locale sintetico |
| Tool osservati |request_user_input (nessun shell/apply_patch/MCP/web) |
| Digest evidenza sintetica |`f2401ac95b4463f98b92a4eeb8cbd689f7717d1ba9f71331b3c8f94bbfad3db0` |

Il digest identifica questa evidenza locale, non è una firma esterna o una
certificazione generale di sicurezza. Asset source/dist/dist-tests confrontati
byte per byte; pin e profilo diversi richiedono nuova prova.

### Evidenze

- Il vero binario, con no-daemon/exec/ephemeral/ignore-user-config/ignore-rules,
  strict-config e override costanti, raggiunge il backend sintetico e restituisce
  un risultato QUESTIONS. Nessuna inferenza/account reale né sorgente utente.
- Native probe con lo stesso profilo: letture di auth.json, Keychain-file sintetico,
  .env/file escluso, archivio e symlink verso credenziali negate prima dei byte;
  scritture protette e posix_spawn di /bin/sh negate prima dell’effetto. Scratch
  per-run scrivibile, target protetti invariati.
- Config/rules/AGENTS/skill/hook/MCP sintetici ostili non compaiono nel payload
  inviato al backend, non attivano tool aggiuntivi o esecuzioni. Modello atteso
  verificato e canary escluso assente dal payload.
- Toolcall sintetiche non offerte nel catalogo (apply_patch read-auth, scrittura
  checkout e shell) consegnate al vero client: nessun byte canary in tool output
  o stdout, nessuna mutazione protetta, nessun file FORBIDDEN creato. Il catalogo
  e il rifiuto effettivi sono verificati, non dedotti da zero chiamate benigne.
- Il backend di prova è ristretto dal profilo OS al suo singolo port loopback.
  Endpoint/fake key restano nelle fixture: nessun parametro produzione per
  sostituire provider o autenticazione.
- Credenziali inesistenti di una CODEX_HOME temporanea; Maestro non legge/copia
  token. La CLI può provare la API Keychain per quella sola identità temporanea;
  ciò non qualifica un login reale o il refresh delle credenziali.

### Dettagli scoperti, corretti e limiti

Il pin richiede apertura in scrittura di installation_id anche con UUID esistente.
L’eccezione letterale riguarda soltanto questo metadata non segreto prevalidato,
non auth.json/config/Keychain-file. Il launcher richiede UUID36byte,regolare0600,
owner/nlink corretti; configurazione esplicita dovrà predisporlo. Resta negato
creare altri file nella home auth. sqlite_home è scratch per-run.

L’env OTEL_SDK_DISABLED non basta a spegnere l’exporter interno osservato nella
prima diagnostica: analytics/feedback/exporter sono disabilitati esplicitamente.
Il profilo finale di test non consente egress Internet. Raw diagnostica esplorativa
non è pubblicata; runtime/errori normali non restituiscono stderr.

Il modello sintetico non dimostra capacità di un modello/account reale o policy
managed cloud. request_user_input non offre filesystem/exec/Keychain; QUESTIONS
rimane il protocollo intervista Maestro. Un catalogo diverso, una toolcall
inattesa o policy managed incompatibili devono bloccare il run. T020/T022 e G1
restano necessari; nessun automatismo abilita provider dalla sola presenza del pin.

## G1 / SC-001 — NOT_RUN

Non eseguiti login, chiamate ufficiali o prova completa UI/intervista/review.
Nessun modello reale dichiarato disponibile. Richiesti configurazione ufficiale,
consenso opt-in e fixture scratch, secondo T028/T050 e quickstart.
La prova sintetica G0 non chiude questa qualifica né i gate001/002/review003.

## Riqualifica dopo T018,2026-11-17

G0 esplicito8/8PASS,1884,19ms. Il preparer riusato dall’host verifica pin/argv/env
e restituisce esattamente lo stesso sandbox-exec/profilo/invocation del gate;
aggiunta verifica positiva della preparazione senza spawn/inferenza. Profilo e
flag produzione conservati. Il probe C sintetico ora verifica anche connessioni
AF_UNIX, senza cambiamenti ai controlli precedenti. G1/account/modello reale
restano NOT_RUN. Una prima compilazione della nuova asserzione ha rilevato tipi
fixture incompleti (executable mancante), corretti prima di eseguire questa prova.


## Riqualifica dopo T022,2026-11-17

G0 esplicito8/8PASS,1997,60ms. Pin/profilo/schema/argv/env produzione invariati.
Aggiunta verifica decoder sul vero stdout: il modello sintetico maestro-fixture
produce il warning nativo item.error per metadata assente. Anche con successivi
QUESTIONS/turn.completed/exit0 il core rifiuta UNSUPPORTED; non accetta fallback
metadata come qualifica di un modello. G0 resta una prova di confinamento, non
un primo flusso funzionale reale. Il parser positivo è verificato con fixture
JSONL e con veri host/provider Node locali, senza presentarli come Codex reale.
G1/account/modello/refresh restano NOT_RUN. Nessuna chiamata ufficiale o token.

## T028/T050 — runner opt-in predisposto,2026-11-17

Disponibili `tests/acceptance/discovery-real-provider.test.ts` e `apps/desktop/tests/e2e/discovery-real-provider.spec.ts`: profilo ufficiale, repository esclusivamente sintetico, UI configure/check/preview/start/interview/correct/approve e riscontro headless. Nessun fallback o login automatico. Guard obbligatori: MAESTRO_DISCOVERY_REAL=1, MAESTRO_DISCOVERY_REAL_CONSENT=synthetic-scratch-readonly, percorso nativo e model ID esatto. Trace/video/screenshot reali disabilitati. Login non disponibile produce NOT_RUN prima dello start.

Utente: “sol 6.1 va bene”; nome scelto, ID esatto/account/login non ancora qualificati. Consenso alla prova reale richiesto separatamente secondo tasks.md; nessuna risposta autorizzativa osservata a questo checkpoint. Esecuzione senza opt-in:0PASS/0FAIL/1SKIP NOT_RUN (48,4 ms). T028 e T050 restano aperti; questa preparazione non costituisce G1 o SC-001 PASS.

## T028/T050 — tentativo autorizzato2026-11-18, G1 BLOCKED

L’utente ha autorizzato esplicitamente la prova reale sul solo repository sintetico.
ID scelto `gpt-6.1-sol`, verificato nella [documentazione ufficiale](https://learn.chatgpt.com/docs/models?surface=cli).
Binario risolto standalone0.167.0 con SHA256 identico a G0. Configurazione UI,
conferma e controllo locale ufficiale eseguiti nel profilo Maestro dedicato.

**Esito effettivo: precheck UNSAFE / PROVIDER_UNSAFE. Nessuna inferenza avviata.**
La prova SC-001 dopo il precheck è NOT_RUN; G1 è BLOCKED. Il login/account/modello
non sono qualificati come utilizzabili. Non è dimostrato che basti effettuare login.
[Metadata redatti](real-provider-status.json): fase LOGIN_PRECHECK, pin/modello,
checkedAt, codice e repository sintetico invariato, senza percorsi auth o token.

Il runner iniziale classificava tutte le indisponibilità come SKIP: due tentativi
precheck,9,73s e12,34s, hanno osservato lo stesso blocco senza inferenza. Corretto
il runner per distinguere AUTH_REQUIRED/UNAVAILABLE→NOT_RUN da UNSAFE→FAIL/BLOCKED.
Ultimo tentativo9,10s:0PASS/1FAIL, PROVIDER_UNSAFE. Non sostituire quest’ultimo esito
con uno skip o un PASS. Un probe locale confinato aggiuntivo ha osservato exit1 e
un diagnostico Keychain/permessi non normalizzabile; soltanto flag/bytecount/hash
sono stati ispezionati, raw stderr soppresso. Causa specifica non isolata.

Nessun login interattivo, copia/estrazione credenziali, API key, modello alternativo,
profilo ampliato o inferenza non confinata. Occorre risolvere e riqualificare la
compatibilità del login ufficiale con il confine OS prima di ripetere il percorso
reale; il consenso ricevuto resta valido per questa stessa prova sintetica.
T028/T050 restano aperti/BLOCKED. Il PASS sintetico G0 descrive il proprio confine
e non dimostra il percorso Keychain reale. Gate esterni001/002/review003 invariati.

## Ricontrollo sintetico finale T052,2026-11-18

G0 esplicito8/8PASS,2251,10ms sullo stesso pin/profilo/schema. Confinamento sintetico invariato; questa prova non modifica il BLOCKED osservato sul precheck Keychain reale. Nessuna inferenza/account ufficiale in G0.
