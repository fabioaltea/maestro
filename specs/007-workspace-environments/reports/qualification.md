# Qualifica 007

## T002 — selezione prima della prova

19 novembre 2026, macOS 26.3.1 (a) arm64/APFS. Pin candidato pnpm `9.4.0` già installato con entrypoint reale `/usr/local/lib/node_modules/pnpm/bin/pnpm.cjs`. SHA-256 entrypoint `2651efc8bc13e7d797dc8bb88b552eb5d657c700381db9aee587fdea5c5888d5`. La distribuzione locale comprende 898 file regolari. Digest SHA-256 di righe ordinate `path relativo, NUL, hash file, LF` `55627c40c52384b44eb80282dbfbf37a3af29a8de3472edbdf8e71b7737754bd`. Node 26.13.0 SHA-256 `533bd644c5ae0e0ea3a80e433aad16b817447ccba1e1eea701875eac80cb75d4`.

Il binario locale espone `clone-or-copy` tramite `--config.package-import-method=clone-or-copy`, verificato con `config get package-import-method` in una directory temporanea. Il piano G0 usa `install --frozen-lockfile --ignore-scripts --ignore-pnpmfile --config.package-import-method=clone-or-copy`, store e virtual store espliciti e registry su loopback. Le prove controllano il comportamento effettivo del pin. [Opzioni install](https://pnpm.io/cli/install#--frozen-lockfile) · [Hook pnpm](https://pnpm.io/pnpmfile)

Tre integrazioni RED per assenza iniziale della primitiva. Casi per isolamento tra due tree e store, lock stale, config/hook ostili, registry estraneo, cancellazione e uscita verificata. G0 ancora NOT_RUN.
