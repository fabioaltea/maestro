# Policy — Git Workspaces

## Identità e risorse

Root workspace privata generata dal core esterna a checkout/archivio/provider auth; path `<ownedRoot>/<workspaceId>`, branch `maestro/feature/<featureId>/<workspaceId>` validato con check-ref-format. Path/branch non sono scelti dal renderer. Base è baseBranch locale configurata in002, risolta a commit OID del formato effettivo del repository; non assumere SHA1/40caratteri e non fare fetch implicito. Unborn, ref non commit e base mancante bloccano.

Ownership richiede storeId, repositoryKey, canonical commonDir anchor, worktree Git anchor, parent/root identity e marker privato con operation/generation concordanti con worktree list --porcelain -z. Il marker non viene consumato dall’agente. Repository/helper Git esterni non possono essere mutati tramite environment GIT_* o config eseguibile; l’allowlist del mutatore include soltanto opzioni qualificate. Hooks, fsmonitor, filters/smudge, config includes, alias, external diff e template del progetto non sono trusted; qualsiasi canale non neutralizzabile dal pin blocca G0.

## Provisioning a passi

1. Nuova observation/handoff e grant su (feature approval, baseRef/baseOid, repo anchor, path/branch absent, policy revision).
2. Lease repository e ledger EFFECT_INTENT prima di branch/worktree create. Root assente o directory vuota generata provata; mai adottare file esistenti.
3. Branch create-if-absent da baseOid; worktree add senza force su branch esatto; controlli successivi su HEAD, branch e anchor.
4. Commit READY solo con prova concordante. Errore tra branch e worktree conserva il branch e mette RECONCILING; niente rollback distruttivo automatico.

Tabella recovery: né branch né path + prova no-launch → nessun effetto; branch atteso solo → parziale conservato; branch+worktree+marker concordi → READY; esistenza di path estraneo, branch mosso, proof mancante → BLOCKED. Un nuovo provisioning richiede risolvere il precedente, non un UUID diverso.

## Lease e cleanup

Un lease writer appartiene a holderType/holderId/generation verificati dal core. WAITING_USER può rilasciare CPU, ma non autorizza un altro writer finché checkpoint/quiescenza non sono provati. Lease non rilasciato per TTL o morte UI.

Cleanup eligibility: proprietà valida, nessun holder/processo incerto, nessun tracked/untracked/ignored diverso dal baseline ammesso, nessun conflitto, HEAD attuale e tutti i commit del branch raggiungibili dal target attuale approvato. La sola prova011 storica va rivalidata con ancestry Git e OID. File ambiente007 non sono ignorati alla cieca: prima si chiede cleanup ambiente distinto, se non può essere provato conservare il workspace.

Rimozione senza --force, poi cancellazione branch con expected OID soltanto se ancora integrato. Niente git clean/reset/prune o cancellazione ricorsiva del checkout come fallback. Se un file compare durante il precheck il comando Git deve rifiutare la rimozione oppure il confine di proprietà deve dimostrare che non viene cancellato; G0 deve coprire questo comportamento sul pin. Interferenza forzata dello stesso UID non è isolata dal mutex; incertezza prima dell’effetto blocca, dopo l’effetto è riportata come tale.
