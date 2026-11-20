# Qualifica 009

## T004 — G0 del 20 novembre 2026

`npm run build:test` e `MAESTRO_EXECUTION_G0=1 node --test dist-tests/tests/integration/execution-boundary.test.js`. **5 verifiche PASS**, 0 FAIL, 0 SKIP in 2,2 s. I test distinguono prove positive e rilevazione corretta di capability indisponibili.

| Percorso | Evidenza |
| --- | --- |
| Comparto comando | PASS. Scrittura sul singolo file approvato. Letture/scritture verso Git, archivio, altri workspace, credenziali sintetiche e link negate. Hard link e symlink scartati prima del lancio. Figli e socket non autorizzato negati. |
| Codex 0.167.0 | **G0 sintetico PASS** per app-server stdio e due tool dinamici mediati, in una home sintetica pulita. Il catalogo contiene solo i due tool dichiarati e `request_user_input`. Un tool ha scritto il solo file autorizzato e l’altro ha verificato il file tramite il comando confinato. Processo chiuso con codice 0 e file protetti invariati. |
| Codex exec con MCP | **BLOCKED** per questo trasporto. Il catalogo reale aggiunge tre operazioni generiche sui resource MCP. Le prove con questo percorso non hanno cambiato il file di fixture. [Codice del pin](https://github.com/openai/codex/blob/rust-v0.167.0/codex-rs/core/src/tools/spec_plan.rs) |
| Claude 2.1.142 | **BLOCKED / PROVIDER_UNSAFE**. SHA-256 verificato. Il precheck --version nel comparto ha chiuso con SIGTRAP. Catalogo ed esecuzione non dimostrati. |
| G1 ufficiale | NOT_RUN per entrambi. Il gate reale 004 rimane PROVIDER_UNSAFE. |

Codex SHA-256 `030316ecfbb41f4e7946e584b0063ef333b7a36cd312ba349f2f6869e39b62cc`. Claude SHA-256 `772021afa051160b97e04d379738df84d4cacd311e8c199a325fb013b3eaa448`. macOS 26.3.1 (a), arm64/APFS, Node 26.13.0. Il profilo Codex consente la sola primitive di lookup dei metadati di directory necessaria a sincronizzare le preferenze gestite. L’opzione è stata isolata con confronto su quattro gruppi di regole. Rimangono il blocco di Keychain nel probe 009 e il solo backend sintetico. La generazione locale degli schemi del pin ha confermato il DTO dei dynamic tool. [API Responses](https://developers.openai.com/api/reference/resources/responses/methods/create) · [Specifica MCP](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)

## T035 — quickstart e capability effettive

| Scenario | Evidenza sintetica | Esito reale |
| --- | --- | --- |
| US1 | Il percorso app-server G0 dimostra catalogo e scrittura mediata sul singolo file. Una seconda fixture collega grant, writer, lease e comando nativo e verifica il replay. | Codex G1 NOT_RUN. Claude BLOCKED al precheck. |
| US2 | Risposta da una richiesta indipendente al core, rifiuto di una risposta tardiva, troncamento, stop e riserva di quota. Il parser rifiuta richieste di tool fuori catalogo. | Flusso completo da provider a CLI e Desktop NOT_RUN. |
| US3 | Patch Git sigillata con indice intatto, resume esplicito sul tree corrente, generazione nuova dopo la pausa, restart conservativo con uscita ignota. | Commit da manifest approvato e resume nativo NOT_RUN. |

Il daemon standard pubblica letture del registro e riconciliazione locale. Le mutazioni di provider e run sono presenti nella composizione con porte di fixture. La build standard mantiene disabilitato l’avvio assistito. Keychain, login ufficiale, rete di inferenza, revisione umana e hosting restano separati dalle prove eseguite.
