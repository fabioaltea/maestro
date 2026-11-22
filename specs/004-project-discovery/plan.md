# Implementation Plan: Project Discovery & First Agent Session

**Branch**: `004-project-discovery` | **Date**: 2026-11-16 | **Spec**: [spec.md](spec.md)
**Input**: `/Users/fabioaltea/Repository/maestro/specs/004-project-discovery/spec.md`

## Summary

Primo flusso agente utile: progetto importato → ambito autorizzato → Codex CLI reale → intervista → bozza → approvazione corrente. Core unico e UI client, analisi in sola lettura; niente codice/worktree/merge/installazioni. L’utente ha scelto Codex con login ufficiale, senza introdurre API key o fallback Claude.

Il core prepara un corpus selezionato e verificato, non consegna il checkout all’agente. Codex usa stdin, output strutturato, Keychain e un profilo OS dedicato. G0 qualifica questo confine PRIMA di sorgenti reali. Dominio/provider port separati, sessioni con turni indipendenti e approvazioni core. Nessuna implementazione o chiamata provider da questo piano.

Base003: aad9dde; branch004 creato da003, senza merge in main. T054003/manual review e001/T082,001/T085,002/T093 restano aperti; sviluppo pianificato non significa release acceptance.

## Technical Context

**Language/Version**: TypeScript6.0.3 strict; Node26.13.0 ESM/NodeNext; desktop Electron45.3.0/React19.3.1 esistenti.
**Primary Dependencies**: better-sqlite3 13.0.3 già installato; sole API native Node per processi/fs/crypto. Codex CLI standalone0.167.0 esterna, hash in research.md; nessun nuovo SDK/provider package, auto-install o auto-update.
**Storage**: SQLite schema4 stesso writer WAL/FULL; artefatti privati immutabili sotto archive/discovery, quota dedicata64MiB. Upgrade solo daemon start esplicito; letture schema2/3/4 senza mutazioni.
**Testing**: Node runner e Playwright esistenti; fixture locali con provider simulato; G0 binario vero con backend test locale sintetico; G1 prova reale opt-in con login ufficiale. Nessun test provider/rete eseguito nel planning.
**Target Platform**: macOS26.3/26.3.1 arm64/APFS, Keychain e confinamento OS dietro porte; nessun allentamento se sandbox non disponibile.
**Project Type**: daemon/CLI headless con client desktop, nessun secondo servizio.
**Performance Goals**: funzionalità e limiti misurabili, non throughput LLM. Letture piccole conservano budget2s del core; timeout di preparazione contesto distinto≤30s; latenza provider riportata senza promessa. Nessuna campagna lunga.
**Constraints**: una Discovery attiva per daemon, anche WAITING_USER/RECONCILING; provider remoto solo su consenso e con credenziali gestite da Codex; niente dati esclusi o codice eseguito dal progetto.
**Scale/Scope**: corpus≤1MiB/200file, turno≤2MiB codificati; prima integrazione monoprovider e profilo Project Architect; nessun registry generale profili/skill/tool.

## Constitution Check

| Principio | Prima ricerca | Dopo design / evidenza richiesta |
|---|---|---|
| I Local-first | PASS design: stato/documenti locali | PASS design: letture offline, provider assente non elimina dati; test snapshot/read-only |
| II Headless | PASS: core unico, client separati | PASS design: runtime nel daemon, UI solo CLI; chiusura UI preserva sessione/domande |
| III Provider agnostic | PASS: prima integrazione reale | PASS design: ProviderPort/capabilities neutri, turni portabili, nessun resume proprietario presunto |
| IV Git safety | PASS: solo analisi | PASS design: estrattore confinato e fingerprint dirty/untracked, repository invariato; worktree/merge N/A |
| V Recovery | PASS: intento persistito e query originale | PASS design: slot transazionale, host per-run con handle/challenge/lifeline, no segnali a PID salvati |
| VI Approvals | PASS: consenso e specifica approvata | PASS design: grant core monouso scope/digest/versioni; eligibility rivalidata; nessun permesso da output/prompt |
| VII Testability | PASS: porte sostituibili | PASS design: test invarianti prima del codice, G0 negativo, G1 reale separato, UI E2E essenziale |
| VIII Observability | PASS: correlazione/output limitato | PASS design: journal metadata, output/documenti paginati, redazione/cap/troncamento e budget terminale |

PASS documentale non è qualifica runtime. Al consolidamento del piano G0/G1 erano NOT_RUN (avanzamento implementativo nei report): nessuna violazione accettata per convenienza. Se il confine provider non è dimostrabile si blocca l’implementazione delle storie dipendenti, senza rimuovere FR004/018. Le decisioni sono risolte in research; le prove vengono eseguite nei task di qualifica.

## Project Structure

### Documentation

```text
specs/004-project-discovery/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/{discovery-api,provider-runtime,context-documents,desktop-ui}.md
├── checklists/requirements.md
└── tasks.md
```

### Source Code — previsto

```text
src/domain/discovery/{model,intent,state,approval,documents,context-policy}.ts
src/ports/{discovery,provider,discovery-context,agent-runtime}.ts
src/core/discovery/{operations,dispatch,read,context,launch,interview,review,recovery,lifecycle}.ts
src/platform/macos/discovery/{context-reader,context-sources,context-framing,context-main,agent-runtime,agent-host,agent-proof,provider-launcher,provider-profile}.ts
src/platform/macos/discovery/{context,provider}.sb
src/providers/codex/discovery-result.schema.json
src/providers/codex/{capabilities,argv,parser,adapter}.ts
src/storage/{discovery-schema,discovery-upgrade,discovery-store,discovery-metadata,discovery-artifacts}.ts
src/cli/discovery.ts
src/{bootstrap.ts,core/daemon-main.ts,core/runtime.ts}
src/{client/local-client.ts,ports/platform.ts,ports/storage.ts,ports/registry.ts}
src/protocol/{messages,validation,discovery,events}.ts
src/storage/{schema,registry-upgrade,sqlite-store,worker,readonly-host,readonly-main}.ts
apps/desktop/src/main/{discovery,core-cli,ports,action-handlers,receipt-store,operation-recovery,index}.ts
apps/desktop/src/shared/{bridge-contract,validation,activity-contract,discovery-contract}.ts
apps/desktop/src/renderer/views/{ProjectDetail,Discovery,DiscoveryReview}.tsx
apps/desktop/src/renderer/components/{DiscoveryLaunch,DiscoveryInterview}.tsx
apps/desktop/src/renderer/state/discovery.ts
apps/desktop/src/preload/index.cts
tests/{unit,contract,integration,acceptance}/discovery-*.ts
apps/desktop/tests/{unit,contract,integration,e2e}/discovery-*.ts
```

**Structure Decision**: nessuna ristrutturazione o dipendenza nuova. Aggiornare guard AST per zone provider/domain e asset .sb/schema con build-assets esistente. Adapter provider senza dipendenza da Electron/storage; dominio non importa CLI/OS. Host transitorio è parte del runtime Agent, non un ulteriore daemon o test runner.

## Contesto, consenso e dati

Il preview raccoglie file selezionati tramite estrattore core confinato, forma manifest e corpus sigillato, e non invoca provider. L’utente vede selettori, elenco/copertura/omissioni/byte e invio al provider; conferma una richiesta core bindata a snapshotId/digest, provider profile/hash/modello e configRevision. Solo l’admission durevole consuma il grant e occupa slot unico prima di spawn.

Scope massimo16selettori relativi; nessun percorso arbitrario per renderer. Default deny di credenziali/.git/ignored/binari/link/special files/submodule/nested repository/cache e di tutti i root Maestro, anche interni al checkout. Validazione source con root/ancestor anchor, handle no-follow e fstat prima/dopo, limite effettivo durante crescita. Se il corpus non può essere validato o eccede i limiti, niente invio/troncamento silenzioso. Selezionare meno file, dichiarare la copertura.

Manifest e membership (anche untracked) rivalidati prima di ciascun nuovo run, approval ed eligibility. Risposta alla domanda o correzione avvia intenzionalmente un nuovo run nella stessa sessione, con il contesto persistito e le risposte aggiornate. Modifiche rilevanti richiedono nuova anteprima/consenso; nessun nuovo corpus inviato con un vecchio grant.

Le fonti della bozza sono CODE con sourceId/hash/righe, USER_CONFIRMED con answerId, HYPOTHESIS o UNKNOWN. Il core verifica riferimenti e struttura, non prova automaticamente la verità semantica del modello. Review utente obbligatoria. Revisioni append-only nel solo archivio Maestro; nessun export/commit Git in004.

## Runtime, credenziali e recovery

Codex pin nativo avviato shell:false, argv da allowlist, `--no-daemon exec --json --ephemeral --skip-git-repo-check --ignore-user-config --ignore-rules --sandbox read-only --output-schema ...`, modello configurato e prompt/corpus stdin. Nessun repo/cwd originale, token o nome progetto in argv. Profilo completo e limiti in provider-runtime.md; non presumere la rimozione di apply_patch. Keychain-only, niente auth.json/auto/API key/helper e niente lettura/copia token Maestro. Eccezione tecnica qualificata separatamente: solo installation_id UUID non segreto prevalidato oltre allo scratch (dettagli T003 nel contratto provider); nessun file credenziale. Login manuale con CODEX_HOME dedicato; G1 prova il comportamento reale, inclusi errori auth, senza fingere il riuso del login corrente.

Un host Node per run conserva handle provider, endpoint challenge e lifeline. Ownership separata in discovery_processes, scope agent-runtime. Politica004 cancel-on-owner-loss-v1: chiude solo il figlio posseduto; non adotta processi orfani. Waiting-user mantiene sessione e slot ma nessun processo. Restart core riconcilia prima di abilitare nuove Discovery: uscita comprovata → INTERRUPTED; incertezza → RECONCILING con slot occupato. Il daemon può esporre registro/storia con Discovery bloccata. Nessun retry/ripresa automatici.

Stop esplicito del daemon rifiuta nuove admission, drena registry/Foundation e runtime Agent con lo stesso deadline esistente. Provider SIGTERM≤2s, SIGKILL solo handle vivo se necessario, uscita/host≤4s complessivi nel budget residuo; uscita non provata → stop BLOCKED/UNKNOWN, mai STOPPED fittizio. Nessun allungamento dei10s core/12s UI e nessuna promessa sulla cessazione di un lavoro remoto non verificabile.

## Persistenza e trasporto

Schema4 con tabelle Discovery separate; request_catalog storico invariato e ledger Discovery con trigger incrociati su UUID, checks atomici in ogni admission. Versionare lo SQL storico2→3 e aggiungere3→4 esclusivo su start, integrity/FK checks e fault pre/post commit. Reader accetta2/3/4, registry≥3, discovery=4: altrimenti DISCOVERY_NOT_INITIALIZED. Nessuna lettura modifica lo schema.

Corpi grandi in file immutabili privati0700/0600 sotto archive/discovery; metadati, sequenze, hash e riferimenti nel writer esistente. File+directory fsync prima del riferimento DB; dopo crash artefatti non pubblicati conservati e conteggiati, riferimenti mancanti/corrotti bloccano l’uso. Output parziale pubblicato in chunk, letture soltanto di chunk registrati e hash-validati. Nessun secondo writer SQLite.

Frame IPC/reader64KiB e input bridge32KiB invariati. Payload blob in pagine raw8KiB/base64 con envelope codificato≤32KiB; lista metadata≤20, cursori store/target/revisione-bound. CLI stdout UI256KiB invariato. I metodi mutativi attendono admission≤2s, non fine LLM; preparazione locale contesto≤30s tramite operation UUID. Journal metadata e watermark soltanto, nessun token/chunk di testo del modello.

## Limiti numerici — target progettuali da verificare

| Risorsa | Cap / comportamento |
|---|---|
| Discovery attiva |1per daemon incl WAITING_USER/CANCELLING/RECONCILING; niente coda |
| Run posseduti |1host+1provider; una generazione alla volta |
| Scope/corpus |16selettori,200file,128KiB/file,1MiB totale UTF-8; overflow prima dell’invio |
| Input provider |2MiB codificati inclusa storia/istruzioni; minimo dei cap del modello qualificato |
| Domande/risposte |20domande per Discovery,4KiB domanda/risposta,20turni max; oltre limite messaggio e nessun run aggiuntivo |
| Documento |256KiB bundle,200claim e20sezioni; risposta schema chiusa |
| Output provider |1MiB/linea JSONL,8MiB totali letti/run,64KiB stderr catturato mai esposto; stop al superamento |
| Output conservato |4MiB/run, FIFO UI500righe/1MiB, troncamento visibile senza falso completamento |
| Trasporto contenuti |8KiB raw/chunk; envelope≤32KiB, frame globale64KiB invariato |
| Artefatti Discovery |64MiB allocati/4096file/100Discovery per archivio; ultimi5MiB riservati a esiti/recovery; raggiungimento blocca nuovi dati, niente eviction di approvazioni o lavoro irrisolto |
| Anteprime/grant |4anteprime non avviate, TTL15min solo prima dell’uso; snapshot referenziati pinned senza scadenza; grant core5min monouso; discard esplicito soltanto se non referenziato |
| Letture/refresh |2s core per pagina; polling output≤1/s soltanto vista visibile/non sovrapposto, eventi come invalidazione |
| Preparazione/run |contesto30s; run massimo10min senza garanzia di completamento LLM, oltre limite TIMED_OUT con dati parziali |
| Lifecycle |deadline start/stop core invariati; cancel runtime≤4s, se incerto RECONCILING |

Quota artefatti separata dal diagnostic budget50MiB e WAL2MiB esistenti; niente aumenti impliciti. La durata massima run è un limite operativo, non una campagna di test lunga. Cache globale di terze parti non viene gestita o ripulita da Maestro; il profilo ephemeral e runtime privato ne evitano l’uso nella Discovery.

## Incrementi e gate

1. **G0 capability/safety**: binario pin, OS profile, config/Keychain policy, tool/data boundary dimostrabili con fixture sintetiche senza segreti; se fallisce fermarsi. Nessun contenuto reale prima di G0.
2. **Foundation**: schema4, artefatti/ledger/slot, context e provider/runtime ports, contratti/validazioni; test critici prima del codice.
3. **US1 / G1**: avvio confermato UI/headless, corpus immutabile, primo provider reale. Prova reale opt-in (NOT_RUN se manca login/consenso), separata dai test automatici. Nessuna sostituzione con una sessione finta.
4. **US2 / G2**: output/intervista persistenti, nuovo run esplicito, cancel e recovery con host, chiusura client superstite.
5. **US3 / G3**: documenti, provenance, review/approvazione e eligibility core corrente; nessun endpoint creazione feature.
6. **US4 / G4**: invalidazione contesto/revisioni/reimport, storico conservato, risposta tardiva fenced.
7. **Review**: regressione mirata core/UI, un flusso reale completo SC001, limiti/privacy/tastiera. Nessuna nuova campagna600s, UID o rete eseguita come effetto del planning; gate esterni invariati.

## Complexity Tracking

Nessuna deroga costituzionale. Costi motivati: corpus estratto per non esporre checkout/segreti; host per-run per poter riconciliare/cancellare il figlio dopo perdita del daemon; artefatti immutabili per non aumentare frame/WAL e ledger separato per non ricostruire FK esistenti. Rifiutati secondo daemon, framework agenti generale, registry skill/tool, terminale, SDK aggiuntivi e ripresa proprietaria obbligatoria.
