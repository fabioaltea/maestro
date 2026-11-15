# Maestro

Local headless daemon, CLI and first Electron desktop client, with durable lifecycle,
a project registry and bounded replayable events. CLI clients can disconnect without stopping accepted
work. The current implementation is qualified on macOS 26.3 arm64/APFS, Node
26.13.0, TypeScript 6.0.3 and better-sqlite3 13.0.3. Other platforms are not qualified.

Full release acceptance remains gated: a real second UID/separate-machine access
check and complete IP-denied acceptance must have real passing evidence. A skipped
external check is NOT_RUN, not PASS. See the [002 readiness report](specs/002-project-registry/reports/release-readiness.md).

```sh
npm ci
npm run build
node dist/cli/main.js --help
node dist/cli/main.js project --help
```

Run commands from the repository root (or use an absolute path to the compiled
entrypoint). A relative `dist/cli/main.js` from your home directory points elsewhere.

## Desktop dal checkout

Dalla radice del repository, con Node26.13.0 e dipendenze root installate:

```sh
cd /Users/fabioaltea/Repository/maestro
npm ci
npm run desktop
```

Il comando compila core e UI e avvia Electron con il Node esterno corrente verificato.
Non avvia il daemon. Scegli un archivio locale; per inizializzarlo/avviarlo usa
**Servizio → Avvia servizio → Conferma**. Chiudere l’app lascia attivo il daemon.
Alla riapertura scegli nuovamente l’archivio; non si conserva una selezione implicita.

La UI espone progetti live/offline, importazione di repository esistenti, verifica,
nome/base, rimozione della sola registrazione, lifecycle, operazioni e attività.
Non contiene provider, agenti, terminale, gestione worktree o workflow futuro.
Le osservazioni Git restano datate anche quando il registro è live.

Conferme monouso precedono ogni mutazione. Ricevute private conservano l’UUID originale
prima dell’invio: dopo crash/timeout usa **Operazioni → Aggiorna esito**, senza reinvio.
Un’operazione non trovata resta incerta. Sono rimovibili soltanto ricevute terminali;
limite100. Le ricevute non sono comandi accodati. La rimozione dal registro conserva
repository e file. Offline si legge; non si accodano scritture.

**Attività** legge la storia disponibile. Segui attività apre un solo client;
Riconnetti riprende esplicitamente dal cursore confermato. Un gap richiede Rileggi
stato e storia; il cursore non è conservato fra aperture dell’app. Limiti e test
funzionali proteggono il client; benchmark di volume/durata rinviati per questa UI.

Electron è una dipendenza di sviluppo root. Se l’installazione ha saltato il suo
script e manca il binario, installarlo esplicitamente in fase di setup con
`node node_modules/electron/install.js`; il launcher non scarica nulla. Non ricompilare
better-sqlite3 per Electron: SQLite è usato soltanto dalla CLI con Node26 esterno.
Questa versione si esegue dal checkout; non è un installer firmato/notarizzato.

Vedi [quickstart UI](specs/003-desktop-core-ui/quickstart.md),
[evidenze e limiti](specs/003-desktop-core-ui/reports/validation.md) e
[review manuale da completare](specs/003-desktop-core-ui/reports/manual-review.md).

## Local lifecycle

Choose a new absolute archive path and retain it to inspect/stop the instance:

```sh
state_dir="/private/tmp/maestro-demo-$(uuidgen)"
node dist/cli/main.js daemon start --state-dir "$state_dir" --json
node dist/cli/main.js daemon status --state-dir "$state_dir" --json
node dist/cli/main.js daemon diagnostics --state-dir "$state_dir" --json
node dist/cli/main.js daemon events --state-dir "$state_dir" --limit 100 --json
node dist/cli/main.js daemon stop --state-dir "$state_dir" --json
```

Restart is an explicit durable stop/start. Stop uses the existing Foundation budget;
uncertain ownership never authorizes termination of a saved PID. There is no force
reset. Read-only commands do not initialize an absent archive or repair storage.
Historical RUNNING is not liveness: inspect freshness, liveness and ready.

## Project registry

Start the daemon explicitly, then use an existing local checkout. `project add PATH`
accepts optional `--name NAME` and `--base-branch BRANCH`. Save the returned projectId,
configRevision and requestId; names need not be unique and are not selectors.

- `project list [--limit 1..100] [--cursor CURSOR]`: stable whole-record pages. If
  REGISTRY_CHANGED is reported, restart the list rather than combining revisions.
- `project show PROJECT_ID`: confirmed configuration and dated observation.
- `project verify PROJECT_ID`: save an explicit new observation of the original
  reference checkout without changing configuration. SUCCEEDED/OBSERVED can mean a
  saved UNAVAILABLE/UNVERIFIED observation; it is not a claim of Git readiness.
- `project update PROJECT_ID --expected-revision REV [--name NAME] [--base-branch BRANCH | --clear-base-branch]`:
  atomically update configuration. At least one field is required. Rename/clear do
  not require an accessible repository. Explicit base requires a valid local commit
  ref and never checks out a branch. A no-op preserves configuration revision/date.
- `project remove PROJECT_ID --expected-revision REV`: remove only that registration.
  Files, Git objects, refs, index, local changes and other worktrees are preserved.
  Get returns PROJECT_REMOVED with a dated tombstone. Reimport creates a new UUID;
  an old removal retry cannot affect it. No force/cleanup flags exist.
- `project operation REQUEST_ID`: query the original pending/terminal outcome,
  including offline and after subsequent mutations.

Every command accepts `--state-dir ABSOLUTE_PATH --json`. Mutations accept
`--request-id UUID` and `--timeout-ms` up to 30,000; reads up to 2,000. Omission of a
request ID generates one. After timeout, inspect/retry the same immutable intent/ID;
do not generate another ID to guess whether a mutation committed. A disconnected
client never cancels admitted work. No project mutation automatically starts a daemon.

Exit codes: 0 successful read/confirmed mutation; 2 invalid input/revision/idempotency
conflict; 3 BUSY; 4 blocked/interrupted/unavailable project; 5 timeout/unknown outcome
or unavailable daemon; 6 denied access; 7 persistence/integrity/runtime failure.
Errors include safe cause, retryable and nextAction. BUSY accepted=false has no ledger
promise. UNKNOWN_OUTCOME retains the original request ID. A stale configuration
revision requires rereading and an explicit new intent, not an automatic retry.

Schema 3 upgrades this greenfield Foundation's known schema 2 only on explicit
start with exclusive leases; storeId, journal and outcome history remain intact.
Read-only schema 2 registry requests return REGISTRY_NOT_INITIALIZED without upgrade.
Unknown versions/corrupt or uncertain storage fail explicitly; there is no migration
from the earlier Maestro product and no automatic rebind/recreation of a checkout.

## Observations and events

A repository shared by main/linked checkouts has one active registration; the first
confirmed reference remains fixed. File status refers to that checkout's direct
entries, excluding submodule contents. Nullable facts mean unverified, never clean.
Empty/unborn/detached repositories can be registered with no configured base; a
first external commit does not select one. Stored observations are LAST_KNOWN even
when the registry envelope is LIVE. Changing configuration keeps older evidence dated.

`daemon events --after CURSOR` replays the same Foundation/registry journal;
`--follow` observes replay/live events. A cursor advances only after successful
application; a gap requires reread-status and an explicit resync. Client failure
never silently reconnects or repeats a mutation. Names, paths, contents, environment,
credentials and raw stderr do not enter diagnostic payloads. Limits remain 16 KiB/event,
64 KiB/outbox, 60 KiB/page and 1 MiB/client. Pressure diagnostics expose bounded queue,
probe and failure counts. At most four probes and 32 admitted pending operations run.

## Verification and scope

```sh
npm run typecheck
npm run lint
npm test
npm run test:contract
npm run test:integration
npm run test:acceptance
npm run bench:foundation

# Desktop: suite separate; il core si verifica senza Electron
npm run typecheck:desktop
npm run build:desktop
npm run test:desktop:unit
npm run test:desktop:integration
npm run test:desktop:e2e
```

Ordinary tests exclude acceptance. Acceptance includes a real ten-minute idle test;
benchmark is a separate ten-minute observation. Keep the host awake and run load,
idle and benchmark campaigns separately. The 500 ms/2 s read, 5 s/30 s inspection,
150 MiB/1% idle targets are not blanket guarantees. Current raw measurements and
errors are in [performance](specs/002-project-registry/reports/performance.md).

All four user stories and E1/E2/E3 have separate evidence in
[002 reports](specs/002-project-registry/reports/), with bounded-pressure and final
acceptance status recorded separately. Provider integrations, Agent Runtime,
Discovery approval, Git/worktree management and dependency execution
are future scope. The first Electron client is feature003, with its own evidence
and pending human review. No registration declares a project ready or approves future work.
See [quickstart](specs/002-project-registry/quickstart.md),
[contracts](specs/002-project-registry/contracts/) and
[real local-access runner](tests/fixtures/multi-user-runner.md).
