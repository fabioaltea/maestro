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

## T035 — quickstart verificato il 20 novembre 2026

Profilo locale macOS 26.3.1 (a) arm64/APFS, Node 26.13.0 e pnpm 9.4.0. Ricontrollo G0 **4 PASS**. Hash SHA-256 del profilo nativo di validazione `b935c9198c4fe470bd14703efdfb30f824eff6368c2feeb644c0add6f96aabf4`.

| Scenario | Stato e prova |
| --- | --- |
| US1 | PASS. Pianificazione statica pnpm, fallback manuale, grant stale respinto e attestazione storica offline. |
| US2 | PASS. Due worktree con lockfile distinti, copie indipendenti, frozen, blocco degli hook, cancel durante una richiesta loopback e recupero della prova dopo risposta persa. |
| US3 | PASS. Uscite 0 e 14, timeout, cap con troncamento, metacaratteri letterali, scrittura sul worktree e connessione loopback negate. Restart pre-lancio e prova post-effetto con output originale interrogabile. |
| Desktop | PASS su piano, installazione, controllo, conferme, Escape/focus, ricevute e letture offline. Cambio archivio verificato in US1. |
| Registry privato/autenticato | BLOCKED per capacità assente. Rete esterna e credenziali fuori dallo scope del profilo. |
| Login, inferenza, hosting e repository utente | NOT_RUN. Le prove usano fixture e processi locali reali. |
| Review umana | NOT_RUN. |

I limiti implementati sono 5 min per job, 1 MiB/200 file per input, 64 KiB per l’acquisizione subprocess, una riserva terminale separata e un solo job attivo per archivio. Il profilo campiona lo spazio APFS e la crescita di moduli/store fino a 200.000 elementi; soglie 10 GiB per workspace, 20 GiB per archivio e minimo 2 GiB liberi. Le soglie sono verificate con casi di policy e campionamento locale, senza prove di riempimento fino al limite fisico. L’output consultabile è diagnostica strutturata. Il caso pnpm con lock vuoto segue il percorso manuale per preservare il lockfile.

Le capacità live `environment.plan`, `attest`, `prepare`, `cancel`, `validate` e `reconcile` dipendono dalla composizione del servizio. Il reader espone piano, job, operazione e artefatti storici. [Quickstart](../quickstart.md) · [Validazione](validation.md)
