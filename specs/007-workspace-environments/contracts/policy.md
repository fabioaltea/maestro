# Policy — Environments

## Pin e piano

Rilevare packageManager e lockfile senza eseguire codice. Se il progetto dichiara una versione esatta, il binario configurato deve corrispondere; se assente, l’utente seleziona esplicitamente un binario/versione da qualificare. Registrare realpath/hash/versione. Niente Corepack download, global install o cambio package manager impliciti.

Plan tuple: workspace/generation/tree inputs, manager/hash, lock/manifests/config digests, workspace graph, registry/network allowlist, script/hook policy, store policy, CommandSpec e limiti. Frozen install non ammette cambio lockfile; progetti senza lock o con fonti git/path esterne/config eseguibile richiedono revisione esplicita e non sono READY per default.

Store condiviso Maestro per contenuti compatibili; virtual store e node_modules separati per workspace. Richiedere clone-or-copy sul pin qualificato per evitare scritture via hardlink verso lo store o altro workspace. Sul filesystem senza clone il fallback è copy, non hardlink. Deduplicazione non è una percentuale promessa: registrarne i byte osservati nel caso bounded. Per evitare input ambiente globale non dichiarato usare env/config allowlist; symlink delle dipendenze devono risolversi solo nello scope approvato.

## Script/config e credenziali

La modalità iniziale è frozen con lifecycle scripts disabilitati E canali pnpmfile/plugin/hook/config eseguibile neutralizzati o rifiutati. Non assumere che ignore-scripts copra pnpmfile. Il mapping flag esatto dipende dal pin: G0 verifica che config locale/globale/managed non prevalga sulla policy e che nessuno script inatteso parta. Script/build necessari richiedono nuovo piano con manifest degli eseguibili e grant di esecuzione; se il progetto non funziona senza script si presenta BLOCKED/MANUAL_REQUIRED invece di READY fittizio.

I job non ereditano credenziali provider o variabili ambientali generiche. Registry privato solo mediante helper/config dedicata autorizzata fuori dal renderer; se isolamento da codice installato non dimostrabile l’install autenticata è UNSUPPORTED. Nessun tool/helper sconosciuto auto-avviato.

## CommandSpec e readiness

CommandSpec: ID, executableRef risolto dal core e hash/versione, argv array validato, relativeCwd confinato, env allowlist senza segreti, networkScope, timeout≤5min, expectedInputDigest, output cap. Non è una stringa shell. Comandi che necessitano shell devono avere un interprete/script esplicitamente approvato nel manifest e il medesimo confine OS; il client non fornisce script libero.

L’implementazione iniziale legge fino a otto descrittori `{id,entry,argv,timeoutMs}` in `package.json.maestro.validation`. Ogni entrypoint è un file ESM regolare alla radice del worktree. Il piano sigilla il digest del file, il pin Node e il digest del profilo read-only. La copia approvata gira con cwd nella radice del worktree: uno script può leggere file da lì, mentre gli import relativi all’entrypoint risolvono dalla copia privata. Rete, scritture sul worktree e processi figli sono negati. Stdout e stderr sono limitati durante l’esecuzione e confluiscono in diagnostica strutturata con conteggi e troncamento.

Con pnpm 9.4.0 il percorso senza dipendenze usa MANUAL_REQUIRED: il binario tenta una scrittura sul lockfile anche in modalità frozen con un lock vuoto. Il profilo mantiene la protezione del lockfile.

READY = job install con uscita verificata0, lock/manifests/config ancora identici, store isolation qualificata, workspace anchor corrente, nessun processo incerto. Attestazione manuale mostra MANUAL_VERIFIED con limitazioni, non QUALIFIED_READY:009 può usarla solo se execution grant accetta esplicitamente la manualità.

Quota disco osservata non è hard enforcement APFS. Controllo prima/spawn e campionamento bounded durante job; overrun cancella il solo albero posseduto e marca blocco. Non eliminare cache globali o node_modules altrui. Cleanup ambiente elimina solo una generazione di artefatti posseduti, senza job/lease e riferimenti; il contenuto progetto resta intatto.
