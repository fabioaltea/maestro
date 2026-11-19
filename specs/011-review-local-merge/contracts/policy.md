# Policy — Review & Local Integration

## Snapshot, criteri e candidate

Review source deve essere quiescente, commit OID/tree coerenti con checkpoint e manifest senza file esclusi dalla review. Se ci sono modifiche non committate, richiedere checkpoint/commit core009 con grant distinto, oppure mostrare BLOCKED; non auto-commit durante review. Diff comprende stato staged/unstaged/untracked fino a snapshot, niente segreti noti esclusi silenziosamente. Oltre100file/2MiB è REVIEW_SCOPE_LIMIT: fornire piano di review esplicito successivo o ridurre feature, non troncare approvazione.

Ogni criterio required ha PASS su prova corrente, oppure decisione manuale documentata se il criterio ammette controllo umano. Invarianti/safety e test richiesti non derogabili dal checkbox. NOT_RUN/SKIP/BLOCKED non sono PASS. Documentazione richiesta è parte del tree candidate; la sola nota che sarà aggiornata non chiude il criterio.

1. source/checkpoint/plan correnti, no writer attivo.
2. targetRef locale/OID dichiarati. `worktree list` mostra checkout esterno del target → TARGET_IN_USE; non chiedere grant per reset/stash, proporre altro target o azione manuale fuori dal comando.
3. target libero: creare guard worktree owned con normale checkout del branch senza force; preservare prenotazione per tutta l’integrazione. Repository mutex blocca altri mutatori Maestro ma non Git esterno arbitrario.
4. staging detached owned da targetOid, merge sourceOid con comportamento deterministico e hooks/config eseguibile neutralizzati. Conflitto preserva source/staging, nessun target update; risoluzione manuale genera nuovo candidate/digest.
5. Candidate immutabile con source/target parents e tree; eseguire check pertinenti sul candidate tree. Evitare riuso di prove source se merge cambia tree/config.

## Approvazione e pubblicazione locale

Integration decision e grant legano feature plan revision, review digest, candidateOid/tree, expectedTargetOid/ref, validation evidence digests, documentation refs, workspace/guard identity, core policy. Prepare mostra anche nome/identità autore dei commit e strategia deterministica (fast-forward se target è antenato di source, altrimenti merge commit con entrambi i parent). Nessuna riscrittura source/target non autorizzata.

REF_INTENT durevole con expectedOld/candidate/newOid → Git update-ref CAS → prova ref → REF_UPDATED durevole. L’aggiornamento atomico della ref non sincronizza index/worktree del guard. Prima di riallineare guard verificare che file/index rappresentino ancora l’esatto precedente tree e che nessuno abbia scritto; riallineare solo la risorsa owned con questa prova, altrimenti NEEDS_RECONCILE e conservare file. Non usare reset come recovery cieca.

Ledger e Git non sono una sola transazione. Recovery: ref==old e prova no-effect → ripreparare soltanto con grant valido/nuovo; ref==candidate con proof concorde → completare bookkeeping e guard sync; ref diversa/branch spostato o attribuzione ambigua → BLOCKED/INTEGRATION_UNKNOWN, mai remerge. Reachability da sola non prova che l’operazione specifica sia avvenuta; conservare candidate/ref proof e riportare limiti di attribuzione.

Il guard prenota la branch rispetto al normale `git checkout/worktree add`; `--force` o update-ref esterni dello stesso UID possono infrangere la prenotazione e sono interferenze fuori dal modello cooperativo. Il piano non le nasconde come protette da mutex. Nuova osservazione prima/dopo e CAS limitano race delle ref; stato incerto blocca. Se requisito futuro richiede isolamento da attori same-UID arbitrari, questa capacità è non qualificata senza un confine OS aggiuntivo.

## Dopo integrazione

IntegrationReceipt contiene source/candidate/target OID, prove e review/document refs.006 può usarla come riferimento storico ma rivalida HEAD/reachability/proprietà prima di cleanup. Freshness004 ricalcolata secondo le sue regole, non auto-approvata.012 richiede grant pubblicazione distinto e non deriva autorità dal receipt. Guard e staging rimossi solo con controllo no-work e ownership, senza prune globale.
