# Policy — Execution Runtime

## Contratto provider-neutral

ExecutionProviderPort: inspectConfiguration, capabilities, prepareInvocation, serializeInput, streamDecoder e classifyFailure. Input contiene Feature/ExecutionEnvelope, checkpoint e allowed action descriptions; output normalizzato PROGRESS,TEXT,QUESTION,TOOL_REQUEST,CHECKPOINT_PROPOSAL,COMPLETED,FAILED. COMPLETED indica risposta terminata, non exit locale provata o criteri PASS. Note/checkpoint proposti dall’agente non sono fatti core finché verificati.

Capability tuple qualificata: providerId,realpath/hash/version,authMode/model,policyHash,toolCatalogHash e flags read/write/exec/interactiveQuestion/nativeResume/localCancellation/remoteCancellation/quotaObservation/toolMediation. Nessun cast del result schema004. Un tool interno non disabilitabile o non confinabile impedisce write/exec. Non usare bypass di permission/sandbox per automatizzare. Il pin Codex004 e un futuro pin Claude hanno report separati. Per Claude --bare non usa login subscription/Keychain: il progetto non introduce una API key per risolverlo.

## Envelope e start

Tuple autorizzato: feature revision+approval, Discovery approval+context, workspace identity/generation/currentTreeDigest, ambiente e manualità accettata, profile resolution, provider config/capabilities, tool/network permissions, run budget e command refs. Al consumo grant ricontrollare tutto. Il provider vede solo corpus/checkout e tool previsti; nessun path archive/credential in prompt/argv.

Admission iniziale usa un solo lock runtime agente complessivo004/005/009 più lease writer/workspace.005/004 senza processo possono restare WAITING_USER nei loro limiti di sessione senza consumare CPU; contesti non quiescenti mantengono reservation.010 estende al budget globale4 preservando i limiti specifici.

Protocollo: durable SPAWN_INTENT → host WAIT_GO → HOST_READY e challenge durevoli → START_AUTHORIZED durevole → GO. Nessun effetto prima GO; crash dopo GO senza exit proof resta RECONCILING. Host e provider command compartment separano credenziali/provider network dai processi di progetto. Challenge key e runtime endpoint non leggibili dal provider/child. Se la CLI non permette tool mediation sicura e OS confinement preventivo, quella capability rimane non disponibile.

## File, commit e controllo processi

Deny `.git` file/dir e shared commonDir, checkout originale, altri workspace e archive; OS deny prima dell’effetto, comprese symlink e child processes. Test/build possono richiedere rete separata e devono usare CommandSpec approvato; nessun ambiente credenziale generico ereditato. Un worktree non è una sandbox e l’accesso alle stesse risorse da attori arbitrari dello stesso UID non è isolato da un lock Maestro.

Commit core: fermare tutti i writer, sigillare manifest tracked/untracked/diff, mostrare scope/identità autore configurata e richiedere grant CHECKPOINT_COMMIT prima di stage/commit. Nessun git add indiscriminato o git config globale; hooks/filters/config eseguibile neutralizzati sul pin. Commit fallito conserva file e index posseduto, mai reset utente. Checkpoint può referenziare patch bounded senza commit se non autorizzato; limite superato blocca checkpoint portabile e review fino a risoluzione esplicita.

Pause = cancel controllato + checkpoint, non SIGSTOP persistente né native resume promessa. Conferma STOPPED solo su process handle/generation e prova di uscita. Un PID trovato nel DB non autorizza segnali; owner loss applica cancel-on-owner-loss del runtime con deadline esistente. Unknown trattiene lease/slot e permette consultazione/reconcile.

## Resume

Checkpoint schema v1 separa VERIFIED facts (commit/tree/prove file/job) e AGENT_NOTES, include pending criteria e limiti. Applicare patch solo se base e manifest correnti, niente replay di comandi esterni da checkpoint. Resume emette nuovo grant/run/generation, lascia il precedente immutabile. Cambiare provider richiede nuovo destinatario autorizzato, portabile input e capability compatibili; lo scheduling automatico appartiene010.
