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
