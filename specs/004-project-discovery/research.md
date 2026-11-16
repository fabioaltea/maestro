# Research — Project Discovery & First Agent Session

Ricerca2026-11-15, consolidamento2026-11-16. Ricerca documentale e ispezione read-only del checkout/binari; nessuna chiamata modello, login, installazione o prova runtime eseguita. Stack001–003 confermato dai manifest locali. Decisioni risolte; qualifiche di esecuzione elencate come gate futuri, non PASS.

## R1 — Primo provider: Codex CLI con login ufficiale

**Decision**: scelta esplicita dell’utente: Codex CLI. Primo profilo di qualifica0.167.0, standalone arm64 nativo già installato. Realpath osservato `/Users/fabioaltea/.codex/packages/standalone/releases/0.167.0-aarch64-apple-darwin/bin/codex`; SHA256 `030316ecfbb41f4e7946e584b0063ef333b7a36cd312ba349f2f6869e39b62cc`. Nessuna dipendenza SDK o installazione provider nel package Maestro. Versione/realpath/hash accettati soltanto dopo G0, poi ricontrollati a ogni avvio.

**Rationale**: interfaccia CLI supportata, login gestito dal provider, stdin e output strutturato; nessun token estratto da Maestro. `exec --json --output-schema --ephemeral` è adatto a turni indipendenti; `--ignore-user-config` e `--ignore-rules` isolano configurazioni ordinarie. `--no-daemon` risulta dall’help globale della build osservata; non avviare un servizio Codex persistente. [Non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode), [CLI reference](https://developers.openai.com/codex/cli/reference/).

**Alternatives considered**: app-server aggiunge un protocollo senza risolvere da solo i permessi; SDK/API diretta cambia autenticazione e prodotto integrato; Claude Code bare offre tools vuoti ma richiede API key anziché login subscription. L’utente ha scelto Codex: nessun adapter Claude o fallback automatico in004. [Claude CLI](https://code.claude.com/docs/en/cli-reference), [bare/auth](https://code.claude.com/docs/en/headless).

## R2 — Permessi effettivi: corpus sigillato e confine OS

**Decision**: estrattore core fidato in lettura → corpus autorizzato con sourceId/hash → stdin provider. Cwd vuota posseduta, mai checkout originale, istruzioni/schema dal pacchetto Maestro. Adapter Codex disabilita shell, immagini, web, MCP, app/plugin, hook, skill discovery e delegazione; provider confinato da profilo macOS distinto da quello Git.

**Rationale**: read-only Codex non impedisce tutti i comandi di progetto o tutte le letture. Non esiste nelle fonti consultate un flag universale comprovato per rimuovere ogni tool, inclusa apply_patch. Non inventarlo. Gli strumenti residui possono soltanto essere inutilizzabili per leggere dati esclusi/eseguire/scrivere: il kernel deve negare l’accesso prima dell’effetto o della produzione di contenuti. Un evento/tool inatteso rende il run fallito, ma questo controllo a posteriori non sostituisce il confine OS. [Configuration Reference](https://learn.chatgpt.com/docs/config-file/config-reference).

**Alternatives considered**: prompt «non scrivere», worktree, shell allowlist arbitraria e accesso diretto al repository non soddisfano FR-004/018. Nessun container, VM o sandbox generica aggiuntiva.

**Gate G0**: prima di contenuti reali, vero binario pin con backend di inferenza locale sintetico nei soli test, catalogo strumenti e tentativi ostili; profilo OS su letture auth/archivio/checkout, symlink, exec, scritture e config ostili. Non basta osservare zero tool calls su un prompt benigno. Policy managed/cloud incompatibili, tool/network surface non controllabile o sandbox negata → PROVIDER_UNSAFE/BLOCKED. Questo è un test da implementare, non una qualifica già ottenuta. I vecchi limiti outer sandbox non vengono aggirati.

## R3 — Autenticazione Keychain, senza file credenziali leggibili dall’agente

**Decision**: `cli_auth_credentials_store="keyring"` obbligatorio, CODEX_HOME dedicato e stabile per utente, estraneo al checkout: `~/Library/Application Support/Maestro/providers/codex-discovery/`. Login manuale tramite CLI ufficiale, esplicito e separato. Maestro non legge, copia o salva token e non accetta API key in UI/argv. `auto`/file/auth.json e helper eseguibili sono vietati nel primo profilo.

**Rationale**: keyring richiede lo store OS; `auto` può ripiegare su file. Il provider può usare le API Keychain necessarie, mentre la policy OS nega letture di file credenziali e tutti gli altri home/archive path. HOME/XDG/TMP runtime sono privati per run. Il login dell’installazione attuale potrebbe non essere condiviso con CODEX_HOME dedicato: non prometterne il riuso automatico. Managed requirements incompatibili producono blocco, non vengono disattivati. [Authentication](https://learn.chatgpt.com/docs/auth), [config](https://learn.chatgpt.com/docs/config-file/config-reference).

**Alternatives considered**: copiare auth.json, estrarre OAuth, passare token al renderer o assumere credenziali disponibili violerebbe il confine. G0 senza segreti reali e prova Keychain/provider reale G1 separata, opt-in; nessuna di queste prove è stata eseguita ora.

## R4 — Contesto verificabile della working copy

**Decision**: scope con massimo16selettori relativi (file/directory); inventario tracked e untracked non ignored tramite Git fidato e query allowlist. Escludere submodule/nested repo, link, file speciali, binari, dipendenze/cache, percorsi segreti e tutti i root canonici Maestro/runtime/auth anche quando l’archivio è dentro il repository (T060). Snapshot immutabile fuori checkout con membership, anchor, hash dei byte e righe. Dettaglio nel contratto context-documents.

**Rationale**: HEAD/configRevision non descrivono dirty/untracked. Root/ancestor identity e fstat prima/dopo la lettura, estrattore OS-confinato, nessun dato inviato prima del sigillo. Rilettura scope/inventario prima di start, answer/correction, approve ed eligibility; nessun watcher permanente. `checkedAt` è una fotografia: la futura creazione feature dovrà ripetere la verifica.

**Alternatives considered**: clone/worktree, sole date mtime o git status cached non provano il contesto analizzato. L’analisi dichiara la copertura selezionata; non promette scansione illimitata o rilevamento infallibile di segreti hardcoded nei sorgenti autorizzati.

## R5 — Persistenza: stesso writer, schema4 e artefatti locali bounded

**Decision**: upgrade esclusivo su daemon start, catena2→3→4. Metadati/operazioni/approvazioni nello SQLite esistente; corpus, revisioni e chunk output immutabili in `archive/discovery/`, pubblicati con fsync file+directory prima dei riferimenti DB. Letture offline confinate, nessun driver Electron. Ledger Discovery separato e collisioni UUID globali impedite con trigger incrociati e admission atomica; non ricostruire il vecchio request_catalog referenziato.

**Rationale**: schema attuale vincola request_catalog a LIFECYCLE/PROJECT e managed_resources a Foundation. Upgrade2→3 oggi usa costanti globali: versionare lo SQL storico prima di alzare SCHEMA_VERSION. Reader supporta2/3/4, registro≥3, Discovery=4; nessun upgrade in lettura. Registry gating non deve più significare «uguale all’ultimo schema». Store identity/journal/progetti restano gli stessi.

**Alternatives considered**: secondo DB, mega-blob nel protocollo o ricostruzione non necessaria delle FK. Artefatti separati evitano di saturare il WAL2MiB/diagnostic budget esistente con output agente; quote dedicate e budget riservato alle transizioni terminali, senza aumentare i limiti Foundation.

## R6 — Agent Runtime separato e turni portabili

**Decision**: una Discovery logica e più run intenzionali. Ogni run `exec --ephemeral` termina con domande o bozza strutturata; risposte e correzioni salvate da Maestro avviano il prossimo run esplicito. `nativeResume=false`, nessuna memoria Codex trasferita o auto-resume.

Un host Node transitorio per run possiede l’handle del provider, lifeline verso daemon ed endpoint challenge autenticato. Non è un altro daemon o framework: riusa le porte process/transport già presenti. Ownership in discovery_processes, mai managed_resources Foundation. Policy004 dedicata `cancel-on-owner-loss-v1`: alla perdita del daemon l’host termina soltanto il provider che possiede, conserva evidenza minima d’uscita e termina; resta sostituibile da future policy Agent Runtime.

**Rationale**: un PID vivo salvato è UNKNOWN nel ProcessIdentity attuale. Un figlio diretto potrebbe sopravvivere a pipe perse; senza host si resterebbe bloccati senza possibilità di cancellazione controllata. Nessun kill/adoption da PID su disco. Se cessazione non provabile, slot RECONCILING occupato. Waiting-user persistito non richiede un processo vivo.

**Alternatives considered**: riuso di drainFoundationAuxiliaries o scanner PID; applicazione cieca di una policy agenti futura; nuovo servizio provider permanente. Stop drena Agent Runtime nel budget esistente, mai falsa conferma di cessazione remota.

## R7 — Interfacce, eventi e prove proporzionate

**Decision**: nuovo namespace CLI/local IPC discovery; status capability discoveryVersion1. Avvio restituisce accettazione e identità, non attende l’intera analisi. Journal conserva solo metadati e watermark; output/documenti si leggono a pagine con stessa infrastruttura CLI e stream003. UI aggiunge pannello Discovery al dettaglio progetto e conferme/ricevute dello stesso modello, con namespace proprio.

**Rationale**: frame64KiB, input bridge32KiB e reader64KiB restano invariati. Tutte le allowlist core/desktop vengono estese insieme; settlement Discovery non riusa le assunzioni del registro. Prova reale singola end-to-end e fault mirati, non carichi100eventi/s o test600s. Gates001/002 e review manuale003 rimangono separati e aperti.

**Alternatives considered**: terminale generico, server HTTP/WebSocket, stream token nel journal o un nuovo test runner. Nessun nuovo pacchetto runtime necessario.
