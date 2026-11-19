# Qualifica 007

## T002 — selezione prima della prova

19 novembre 2026, macOS 26.3.1 (a) arm64/APFS. Pin candidato pnpm `9.4.0` già installato con entrypoint reale `/usr/local/lib/node_modules/pnpm/bin/pnpm.cjs`. SHA-256 entrypoint `2651efc8bc13e7d797dc8bb88b552eb5d657c700381db9aee587fdea5c5888d5`. La distribuzione locale comprende 898 file regolari. Digest SHA-256 di righe ordinate `path relativo, NUL, hash file, LF` `55627c40c52384b44eb80282dbfbf37a3af29a8de3472edbdf8e71b7737754bd`. Node 26.13.0 SHA-256 `533bd644c5ae0e0ea3a80e433aad16b817447ccba1e1eea701875eac80cb75d4`.

Il binario locale espone `clone-or-copy` tramite `--config.package-import-method=clone-or-copy`, verificato con `config get package-import-method` in una directory temporanea. Il piano G0 usa `install --frozen-lockfile --ignore-scripts --ignore-pnpmfile --config.package-import-method=clone-or-copy`, store e virtual store espliciti e registry su loopback. Le prove controllano il comportamento effettivo del pin. [Opzioni install](https://pnpm.io/cli/install#--frozen-lockfile) · [Hook pnpm](https://pnpm.io/pnpmfile)

Tre integrazioni RED per assenza iniziale della primitiva. Casi per isolamento tra due tree e store, lock stale, config/hook ostili, registry estraneo, cancellazione e uscita verificata. G0 ancora NOT_RUN.

## T004 — G0 sintetico PASS

`npm run build && npm run build:test`, `node --test dist-tests/tests/integration/environment-boundary.test.js` e `npm run lint`. **4 PASS, 0 FAIL, 0 SKIP** in 2,81 s per la suite. Pin binario e distribuzione confermati. Digest del profilo di base e della regola loopback `e379ed792f303dc449edc43d3e69333ed49eb099c915a66d77a6f4cca3064281`.

- Frozen respinge lock e manifest incoerenti preservandone i byte. Script di progetto e dipendenza non eseguiti. Hook locali e configurazioni eseguibili bloccano il precheck. Config ambientale ostile ignorata dal processo isolato.
- Due workspace con virtual store separato usano lo stesso store dedicato. La modifica della copia installata in uno lascia byte dell’altro workspace e dello store invariati. Il pin seleziona esplicitamente clone-or-copy. Il caso non misura deduplicazione o percentuale di cloni effettiva.
- Il profilo consente solo il singolo endpoint loopback approvato. Il nome richiesto dal filtro SBPL sul pin macOS è `localhost:porta`. L’URL fixture resta IPv4 127.0.0.1. Un redirect dal registry permesso a una seconda porta è rifiutato sul confine OS.
- Il profilo nega la creazione di figli. Il probe tenta un child Node e riceve EPERM/EACCES. Un install fermo su risposta HTTP è cancellato tramite il suo handle e la chiusura è osservata. Nessun rilascio derivato da un PID salvato.
- Superficie qualificata inizialmente per pnpm a radice singola, loopback di fixture e modalità offline. Registry autenticati, rete esterna, package manager con pin diverso e comandi script reali restano NOT_RUN. Nessuna capability IPC pubblicata da G0.
