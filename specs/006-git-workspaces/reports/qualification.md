# Qualifica 006

## T004 — G0 nativo su fixture

19 novembre 2026, macOS 26.3.1 (a) arm64. `npm run build:test` e `node --test --test-concurrency=1 dist-tests/tests/integration/workspace-boundary.test.js` hanno dato **8 PASS, 0 FAIL, 0 SKIP** in 3,6 s. Lint e diff check PASS.

- Git 2.50.1 (Apple Git-155), selezionato da `/usr/bin/xcrun`. Binario root-owned `/Applications/Xcode.app/Contents/Developer/usr/bin/git` con SHA-256 `492bd04fb367c1d51dce2be4eb6d6778829a3623dc4327318dfcdd81bc4fac2e`.
- Profilo `workspace.sb` con SHA-256 `43d018cd1163f6593ed8c9e8fca25a529a1912e9e5b1aa01e2ea1593eee3efe1`. Argomenti chiusi, Git fissato, scritture confinate ai path derivati della risorsa e relativo ref, rete negata.
- SHA-1 e SHA-256, base esatta e checkout dirty conservati. Config eseguibile e include respinti, hook e fsmonitor neutralizzati. OID obsoleto, branch già presente, path occupato da symlink e root sostituita respinti.
- SIGKILL prima del worktree add conserva il branch già creato e l’assenza del worktree. SIGKILL dopo l’add lascia un worktree osservabile con HEAD, branch e anchor concordanti.
- Un worktree pulito integrato viene rimosso tramite Git senza force, preservando il ref per il passo successivo. Il profilo di rimozione concede unlink sui path inventariati e conserva il file ignorato apparso dopo l’inventario. Il mutatore restituisce `OWNERSHIP_UNPROVEN` per l’effetto parziale e il branch rimane leggibile.
- L’inventario di rimozione è bounded a 512 path e 64.000 byte di path per l’invocazione nativa. Superato il cap la primitiva conserva il checkout. La policy segnala come incerti gli effetti non provati e mantiene i limiti dichiarati sull’interferenza dello stesso UID.

G0 abilita l’implementazione locale delle capacità dipendenti. La capability del prodotto sarà pubblicabile dopo store, autorizzazione e composizione. I gate esterni e le prove su dati reali restano distinti.
