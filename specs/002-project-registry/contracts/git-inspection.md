# Contract — RepositoryInspector e adapter Git/macOS

Contratto di progetto per FR-002…011, FR-017, NFR-002/003/005. Nessun probe di
questa implementazione è stato eseguito durante la pianificazione.

## Porta e capacità

`RepositoryInspector` espone `capabilities`, `inspectCandidate(path, requestedBase,
deadline)` e `inspectRegistered(identity, referenceCheckout, configuredBase, deadline)`.
Riceve input validati e un cancellation signal del daemon, non callback del client.
Restituisce prova di identità/topologia, osservazione tipizzata e safe error.
`FilesystemIdentity` e `ProbeSupervisor` sono porte OS separate. Il dominio non
riceve handle processi o comandi shell.

Capacità minima: Git qualificato, sandbox con zero fork/helper/rete/scritture,
lettura topologia, HEAD/branch/commit, stato file bounded e anchor filesystem affidabili.
Una capacità assente è esplicita; niente esecuzione non confinata come fallback.
Il profilo iniziale supporta repository locali APFS; varianti di formato/estensioni
non qualificabili producono REPOSITORY_UNSUPPORTED prima di dare evidenza positiva.

## Invocazione sicura

- Ingresso di sistema `/usr/bin/git`, che su macOS è un dispatcher Apple. Risolvere
  il binario reale tramite `/usr/bin/xcrun --find git` fuori da qualsiasi repository,
  ammettendo solo i percorsi di sistema Xcode/CommandLineTools qualificati e root-owned
  non scrivibili da gruppo/altri. Versione e identità ricontrollate; eseguire quel
  binario assoluto confinato. Nessuna ricerca PATH e nessuna shell.
- Argv costruito da builtin allowlisted; input non è codice o opzione. Path assoluto
  validato, nomi ref confinati in refs/heads; `--end-of-options`/`--` dove previsti.
- Ambiente costruito da allowlist: locale stabile, HOME=/var/empty senza configurazioni utente,
  GIT_CONFIG_GLOBAL/SYSTEM=/dev/null, GIT_CONFIG_NOSYSTEM=1, GIT_OPTIONAL_LOCKS=0,
  GIT_NO_LAZY_FETCH=1, GIT_TERMINAL_PROMPT=0, GIT_ALLOW_PROTOCOL vuoto.
  Nessuna eredità di GIT_DIR/WORK_TREE/INDEX_FILE/OBJECT_DIRECTORY/CONFIG_COUNT,
  askpass, SSH, pager, trace, loader injection o altri GIT_* dell'utente.
- Prefisso `--no-pager --no-optional-locks --no-lazy-fetch --no-replace-objects`;
  override core.hooksPath=/dev/null, core.fsmonitor=false, submodule.recurse=false,
  maintenance.auto=false, gc.auto=0. Nessun safe.directory=* globale.
- Queste misure non disabilitano tutta la config locale: ogni comando Git, incluso
  rev-parse/config/status, parte già confinato.

Il profilo macOS, fornito da Maestro e non dal repository, nega tutte le scritture
filesystem persistenti, rete e process-fork. La sola scrittura a `/dev/null` è
necessaria allo startup Git e non conserva dati; lettura delle directory antenate
è permessa come metadato di risoluzione, non come accesso ai contenuti dei file. Permette soltanto l'exec iniziale del Git verificato,
letture runtime necessarie e letture del repository; niente codice del progetto.
Parametri del profilo separati dal testo, senza interpolazione di path ostili.
La qualificazione G1 deve provare anche config cambiata durante il probe, helper
che invoca Git stesso e tentativi di scrittura fuori dal repository. Se il profilo
non può essere applicato o verificato, INSPECTION_UNAVAILABLE prima dello spawn Git.

## Sequenza osservazione

1. Risolvere il path e il checkout più vicino senza scritture; non cercare/inizializzare
   repository o submodule mancanti. Path bare senza checkout rifiutato.
2. Con invocazioni separate e output non ambiguo ricavare top-level, absolute git-dir
   e common-dir (`rev-parse --path-format=absolute --git-common-dir`,
   `--absolute-git-dir`, `--show-toplevel`). Non usare `.trim()` sui path:
   rimuovere soltanto il terminatore definito. Path Unicode/spazi/newline non sono shell.
   Il path candidato risolto deve appartenere al checkout dichiarato: core.worktree
   non può dirottare silenziosamente l'import verso una root estranea.
3. Canonicalizzare e acquisire anchor separati di common-dir, admin dir e checkout.
   La prova comune deduplica anche worktree con common repository bare.
4. Leggere HEAD symbolic oppure detached/unborn, object format e commit esistente.
   Base esplicita: `check-ref-format` e risoluzione esclusiva refs/heads a commit;
   base omessa solo al primo import: branch HEAD valido oppure null.
5. Preflight bounded dei file config locale/worktree con `config --file ... --no-includes`,
   eseguito fuori da qualsiasi checkout per evitare discovery/config preliminari.
   Include/includeIf sono rifiutati con INSPECTION_UNSAFE prima delle altre query:
   Git non offre un no-includes generale e i contenuti inclusi potrebbero essere
   illimitati o FIFO. I driver clean/process rendono invece file status UNKNOWN;
   non lanciare status e non simulare clean disabilitando i filtri. In quest'ultimo
   caso metadata/identità provati consentono registrazione con osservazione parziale.
6. Se sicuro, `status --porcelain=v2 -z --untracked-files=normal --ignore-submodules=all`;
   nessuna patch o contenuto conservato. Record tracciati/untracked/unmerged alimentano
   soltanto booleani. Stato del contenuto interno dei submodule non aggregato;
   la limitazione è esposta anche quando nessun cambiamento diretto è rilevato.
7. Rileggere anchor/topologia/HEAD/base prima e dopo la sequenza e prima del commit.
   Differenze producono REPOSITORY_CHANGED/UNSTABLE, non risultato coerente inventato.

Un output o exit status non interpretabile, filtro bloccato, corruzione o lettura
parziale produce UNKNOWN con codice strutturato. Non validare refs/commit con
`log --all` o scansioni illimitate. Nessun fetch implicito per oggetti mancanti.
Le osservazioni sono evidenza datata; non autorizzano operazioni Git future.

Non eseguire worktree repair/prune, update-index, checkout, reset, clean, fetch,
maintenance, init, build, installazioni o script. Nessuna scrittura di marker identità.

## Limiti e ownership

| Risorsa | Limite iniziale da verificare |
|---|---|
| Probe attivi | 4; un solo comando Git alla volta per probe |
| Pending operazioni registry | 32 inclusi attivi; saturazione BUSY prima dell'accettazione |
| Tempo | Server 28 s da ricezione inclusi admission/coda/cleanup; arrestare Git entro 26 s, riservare 2 s a cleanup/commit; client massimo 30 s |
| Stdout Git | 1 MiB cumulativo/probe, parser incrementale bounded |
| Stderr | 16 KiB/probe, mai esposto o persistito grezzo |
| Config letta | 1 MiB cumulativo, senza espansione includes nella preflight |
| Path / branch | 16 KiB / 1 KiB UTF-8; fuori profilo errore esplicito |
| Input/output | stdin chiuso; nessun file temporaneo nel repo |

Troncamento non equivale a false/clean; OUTPUT_LIMIT e campi UNKNOWN. La coda non
consuma processi o lock Git. Git non gira nel worker SQLite né blocca l'event loop.

Ogni probe usa un supervisor ausiliario Foundation con nonce/generazione verificabili,
lifeline pipe verso il daemon e deadline autonoma. Il supervisor possiede direttamente
l'handle del Git confinato e mantiene la propria identità tramite contratto Foundation.
EOF lifeline, stop o deadline cancellano il figlio proprio e attendono uscita; eventuale
escalation è limitata all'handle posseduto e al budget di cancellazione (≤1,5 s).
Nessuna terminazione tramite PID dal database. Se il supervisor non è più verificabile,
risorsa UNKNOWN/BLOCKED: recovery non dichiara assenza sulla sola mancanza del socket.

Massimo 4 supervisor più 4 Git durante attività, rilasciati al termine. A riposo
nessun figlio: si mantengono 150 MiB/1% CPU su dieci minuti della Foundation, 50 MiB
diagnostici più 5 MiB temporanei, stream ≤1 MiB/client. Nessun tetto esistente viene
alzato. Misurare separatamente memoria/CPU attive e riportarle, senza riciclarle come idle.
Policy valida solo per ausiliari di ispezione della Foundation, non Agent Runtime.

## Gate G1 e prove

Fixture locali: unborn, detached, dirty/untracked, conflitti, submodule, main/linked
worktree, common bare, clone distinto, repo annidato, path ostili/alias, config include,
fsmonitor/hook/filter/alias/pager/extdiff/textconv sentinella, ambiente GIT_* ostile,
partial clone con oggetto mancante, output enorme e checkout sostituito.

Verificare zero sentinelle eseguite, zero pacchetti di rete, nessun cambio di contenuti,
index/ref/config/oggetti; confronti tramite snapshot/hash e metadati rilevanti escludono
atime di lettura. Testare cambi concorrenti di config/ref/topologia e kill del daemon
con probe attivo: niente evidenza falsa o processi propri non riconciliati. G1 fallito
blocca l'integrazione; non si indebolisce il requisito per far passare i test.
