# Tasks: Project Discovery & First Agent Session

**Input**: [spec.md](spec.md), [plan.md](plan.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md).
**Branch**: `004-project-discovery` · **Date**: 2026-11-16 · **Stato**: implementazione avviata; avanzamento e gate nei report, non dedotti dalle sole checkbox.

**Organizzazione**: 54 task in sette fasi; quattro storie con priorità e criteri indipendenti. I test sugli invarianti sono richiesti esplicitamente dalla specifica e dalla Constitution. Scrivere prima i casi pertinenti, osservarne il fallimento atteso e portarli a PASS con l’implementazione; registrare separatamente eventuali impossibilità ambientali. Non introdurre un nuovo runner, dipendenze runtime o campagne lunghe.

**Formato**: `- [ ] Tnnn [P?] [USn?] descrizione con percorsi`. `[P]` identifica lavoro su file distinti, eseguibile in parallelo soltanto dopo i prerequisiti indicati. Percorsi relativi alla root del repository; i file nuovi elencati sono da creare durante l’implementazione. Un commit locale per task, con ID ed evidenza pertinente; nessun commit deve promuovere un gate non eseguito a PASS.

**Vincoli permanenti dell’incremento**: stesso daemon Node e writer SQLite; UI client; sola lettura; Codex CLI con login ufficiale Keychain-only; nessun provider alternativo/failover, API key in produzione, worktree, installazione di progetti, terminale, creazione feature, merge, push o release. La policy Agent Runtime è separata dalla Foundation. Nessun task autorizza implicitamente un login o una chiamata a pagamento/reale: la prova opt-in richiede il consenso previsto dalla specifica; se assente, documentare NOT_RUN.

## Phase 1: Setup e G0 — confine provider prima delle sorgenti reali

**Obiettivo**: qualificare il binario e il confinamento prima di integrare un provider che possa ricevere contenuti di progetto. Non richiede credenziali reali.

- [X] T001 Preparare l’integrazione delle nuove zone senza cambiare stack: aggiornare `scripts/check-architecture.mjs` per impedire dipendenze provider/OS/storage nel dominio e adapter provider dipendenti da Electron/SQLite, e `scripts/build-assets.mjs` per copiare i profili `.sb` e lo schema trusted Discovery. Conservare runner, lockfile root e limiti esistenti; annotare baseline e pin osservato in `specs/004-project-discovery/reports/validation.md` senza dichiarare prove nuove già eseguite.
- [X] T002 Scrivere i casi G0 inizialmente fallenti in `tests/integration/discovery-provider-boundary.test.ts`, con backend di inferenza locale solo sintetico in `tests/fixtures/discovery-inference-server.ts` e canary sintetici in `tests/fixtures/discovery-boundary.ts`: vero binario, catalogo tool effettivo, configurazioni/rules/skill/hook/MCP ostili, tentativi di leggere credenziali/checkout/archivio/symlink e di scrivere/eseguire oltre ambito. Verificare il rifiuto prima di ottenere dati/effetti, distinguendolo dalla sola osservazione di una toolcall.
- [X] T003 Implementare il minimo riutilizzabile per G0 in `src/providers/codex/argv.ts`, `src/platform/macos/discovery/provider-profile.ts`, `src/platform/macos/discovery/provider-launcher.ts`, `src/platform/macos/discovery/provider.sb` e `src/providers/codex/discovery-result.schema.json`: pin nativo, argv/env allowlist shell:false, stdin, scratch privato, nessun checkout/cwd utente, auth keyring obbligatoria, canali non autorizzati disabilitati e policy OS preventiva. Il backend locale/fake credentials appartiene soltanto alla fixture T002, senza opzioni equivalenti nella configurazione di produzione.
- [X] T004 Eseguire G0 con il vero pin e fixture T002; conservare hash/versione/profilo/tool osservati, differenze rispetto al backend ufficiale e risultati negativi redatti in `specs/004-project-discovery/reports/provider-qualification.md`. Non inventare flag per eliminare apply_patch né assumere che read-only blocchi ogni lettura/exec. Se confine, config managed o sandbox non sono dimostrabili, segnare BLOCKED/NOT_RUN e fermare le storie dipendenti; nessun allentamento o dato reale per far passare il gate.

**Checkpoint G0**: prova sintetica del confine sul pin effettivo, non qualifica del login o del modello reale. Tutti i task successivi richiedono G0 PASS; un pin/profilo diverso deve essere riqualificato.

## Phase 2: Foundation — stato, contesto e ownership condivisi

**Obiettivo**: aggiungere le primitive comuni verificabili senza UI o credenziali. I gruppi di test `[P]` sotto possono essere preparati insieme dopo G0; ciascuna implementazione dipende dal proprio test e dai contratti di dominio.

- [X] T005 [P] Scrivere in `tests/unit/discovery-state.test.ts` e `tests/unit/discovery-intent.test.ts` i casi di transizione Discovery/run/operation distinti, WAITING_USER senza processo ma con slot, correzione UPDATING, grant canonici/revisioni/scadenza, UNKNOWN e fine processo senza approvazione; includere i limiti numerici del piano e tempo controllato.
- [X] T006 Implementare tipi, intenti canonici, policy e transizioni neutre in `src/domain/discovery/model.ts`, `src/domain/discovery/intent.ts`, `src/domain/discovery/state.ts`, `src/domain/discovery/approval.ts`, `src/domain/discovery/documents.ts` e porte in `src/ports/discovery.ts`, `src/ports/provider.ts`, `src/ports/discovery-context.ts`, `src/ports/agent-runtime.ts`. Nessun formato Codex nel dominio; capacità sconosciute non disponibili, nativeResume=false e cancel-on-owner-loss-v1 dichiarata come policy di questo incremento.
- [X] T007 [P] Scrivere in `tests/integration/discovery-schema-upgrade.test.ts` e `tests/integration/discovery-admission-store.test.ts` i casi schema2→3→4, crash pre/post commit, integrity/FK/store identity/journal conservati, letture2/3 immutate, slot atomico e collisioni UUID in entrambe le direzioni fra LIFECYCLE/PROJECT/DISCOVERY; usare fixture storica congelata in `tests/fixtures/discovery-schema-v3.ts`.
- [X] T008 Versionare lo SQL V3 in `src/storage/schema.ts` e `src/storage/registry-upgrade.ts` prima di aggiungere `src/storage/discovery-schema.ts` e `src/storage/discovery-upgrade.ts`; collegare l’upgrade esclusivamente allo start esplicito in `src/storage/sqlite-store.ts`. Aggiornare `src/storage/readonly-database.ts` e `src/storage/sqlite-driver.ts` per reader2/3/4, registry≥3 e Discovery=4, senza upgrade o repair da lettura e senza ricostruire request_catalog/FK storiche.
- [X] T009 Implementare ledger Discovery, trigger UUID incrociati, reservation query globale, slot singleton, grant monouso/max32 e admission transazionale in `src/storage/discovery-store.ts`, `src/storage/worker.ts`, `src/ports/storage.ts` e `src/ports/registry.ts`. Consumare grant e registrare operazione/run/intento/outbox atomicamente, recuperare lo stesso UUID anche con grant già consumato da quella richiesta e negare payload diversi; preservare query/cancel/reconcile con riserva terminale.
- [X] T010 Completare nello stesso writer le API metadata per provider/snapshot/processi, domande/risposte append-only, revisioni/approvazioni e output watermark in `src/storage/discovery-store.ts`, `src/storage/worker.ts` e `src/ports/discovery.ts`; applicare CAS, vincoli store/project/run/generation e limiti senza blob grandi. I processi Agent Runtime non entrano in managed_resources Foundation.
- [X] T011 [P] Scrivere in `tests/integration/discovery-artifacts.test.ts` e `tests/integration/discovery-budget.test.ts` i casi reserve→write→fsync→publish→DB, fault in ciascun passaggio, hash mancante/corrotto, symlink/hardlink/owner errati, orfani preservati/conteggiati e quota effettiva comprensiva dei metadati/indici. Provare che a quota piena cancel/query/recovery restano possibili e nessuna approvazione viene eliminata.
- [X] T012 Implementare `src/storage/discovery-artifacts.ts` e relativo budget in `src/storage/discovery-store.ts`: oggetti esclusivi UUID0600/root0700, cap64MiB/4096file/100Discovery, riserva5MiB, commit file+directory prima del riferimento e letture hash-validabili bounded. Preview max4/TTL15min soltanto finché non referenziate; snapshot usati pinned. Discard esplicito soltanto su preview non referenziate; niente cleanup automatico dei repository, eviction o aumento WAL/diagnostic budget.
- [X] T013 [P] Scrivere in `tests/integration/discovery-context.test.ts` e `tests/integration/discovery-git-safety.test.ts` le prove con Git reale clean/dirty/conflitti/unborn, tracked/untracked/ignored, nested repo/submodule, file speciali/link, UTF-8 invalido, crescita e sostituzione ancestor durante lettura. Coprire archive/runtime/auth root interni al checkout, selettore escluso esplicito, membership directory e snapshot prima/dopo senza mutazioni Git o script eseguiti.
- [X] T014 Implementare estrazione/fingerprint in `src/core/discovery/context.ts`, `src/platform/macos/discovery/context-reader.ts`, `src/platform/macos/discovery/context-main.ts`, `src/platform/macos/discovery/context.sb` e query allowlist in `src/platform/macos/git/repository-inspector.ts`/`src/ports/repository.ts`: max16selettori/200file/128KiBfile/1MiB corpus, inventario ls-files fidato e default deny prima della lettura. Verificare root/ancestor/handle/fstat, sigillare manifest+corpus privati e fallire su instabilità/overflow prima dell’invio; preparazione/revalidation asincrona≤30s distinta dalle letture2s.
- [X] T015 [P] Scrivere in `tests/contract/discovery-api.test.ts` e `tests/integration/discovery-offline-read.test.ts` contratti DTO chiusi, capability/errori, grant contro client alternativo, admission diversa dal completamento, pagine/cursori store-bound, envelope32KiB/frame64KiB e reader offline confinato. Provare che una query storica non avvia provider/login, non legge sorgenti e non migra; offline eligibility è sempre false/UNKNOWN.
- [X] T016 Collegare namespace Discovery, validatori/DTO/errori e metadati eventi in `src/protocol/messages.ts`, `src/protocol/validation.ts`, `src/protocol/events.ts`, `src/core/discovery/dispatch.ts`, `src/core/discovery/read.ts`, `src/client/local-client.ts`, `src/cli/discovery.ts`, `src/cli/main.ts`, `src/core/inspect-main.ts`, `src/storage/readonly-host.ts`, `src/storage/readonly-main.ts`, `src/storage/readonly-database.ts` e `src/platform/macos/storage/readonly.sb`. Estendere allowlist e reader confinato solo agli oggetti registrati; pagine raw8KiB/base64, metadata≤20 e envelope codificato≤32KiB, senza path privati pubblici. Registrare solo metodi effettivamente implementati, senza esiti simulati.
- [X] T017 [P] Scrivere in `tests/integration/discovery-agent-host.test.ts` e `tests/contract/discovery-agent-runtime.test.ts` i casi WAIT_GO, crash prima/dopo GO, lifeline persa, proof autenticata/generazione, PID riutilizzato/estraneo, host morto con provider incerto, TERM/KILL sul solo handle posseduto e deadline residuo. Dimostrare che il provider non legge il run key/endpoint privato e che nessun segnale viene inviato da un PID persistito.
- [X] T018 Implementare host per-run e adapter in `src/platform/macos/discovery/agent-host.ts`, `src/platform/macos/discovery/agent-runtime.ts` e collegamento process identity/transport in `src/ports/platform.ts`: SPAWN_INTENT→host WAIT_GO→HOST_READY durevole→SPAWN_AUTHORIZED durevole→GO, challenge/lifeline e exit proof minima autenticata/fsync. Policy004 chiude solo il figlio posseduto dopo perdita owner; prova insufficiente mantiene RECONCILING/slot. TERM2s, totale≤4s entro deadline esistente; nessun secondo daemon o riuso di drainFoundationAuxiliaries.

**Checkpoint Foundation**: test di stato, schema, artefatti, scope, API e ownership PASS senza UI/rete/account. Upgrade solo start; processo sconosciuto non viene adottato o terminato. Ordine implementazioni: T006 → T008 → T009 → T010 → T012 → T014 → T016 → T018, ognuna dopo il relativo gruppo test.

## Phase 3: US1 — Avviare la prima analisi del progetto (P1)

**Obiettivo**: avvio intenzionale, identificabile e unico da headless e UI; dati inviati esattamente dal corpus approvato.
**Prova indipendente**: con progetto temporaneo e provider fixture avviare da entrambi i client, ricevere subito identità/admission e negare doppio invio/assenza permessi; G1 distingue l’avvio reale Codex dal risultato simulato.

- [X] T019 [P] [US1] Scrivere `tests/contract/discovery-launch.test.ts` e `tests/integration/discovery-start.test.ts`: provider assente/auth/capability non sicura, conferma assente/scaduta, digest cambiato, collisione UUID, doppio invio/concorrenza slot e risposta persa pre/post admission. Contare spawn e provare identità durevole prima di ogni effetto, nessun run da preview/check/prepare e repository dirty/conflitto/unborn invariato.
- [X] T020 [US1] Implementare configurazione/check senza inferenza in `src/providers/codex/capabilities.ts` e `src/core/discovery/operations.ts`: path nativo pin/hash/versione/profilo/modello espliciti, realpath/hash ricontrollati prima del run, qualifica G0 richiesta, stato ufficiale login normalizzato e checkedAt. Nessuna lettura/copia credenziali, auth.json/auto/API key; Keychain o managed policy incompatibile blocca con nextAction comprensibile. Configurazione modifica revisioni e invalida grant precedenti.
- [X] T021 [US1] Implementare prepare/grant, preview asincrono e admission start in `src/core/discovery/operations.ts` e `src/core/discovery/launch.ts`: riepilogo invio dati e scope prima del consenso, grant bindato a owner/store/azione/snapshot/provider/modello/revisioni, rivalidazione contesto prima di consumarlo e slot unico atomico. Risposta≤2s sull’accettazione, mai attesa del modello; risposta incerta si risolve con UUID originale.
- [X] T022 [US1] Implementare adapter e parser bounded in `src/providers/codex/adapter.ts`, `src/providers/codex/parser.ts`, `src/providers/codex/argv.ts` e integrazione launch in `src/core/discovery/launch.ts`. NDJSON UTF-8 incrementale≤1MiB/linea/8MiBrun, stderr≤64KiB mai pubblico, input serializzato≤2MiB e cap modello; QUESTIONS/DOCUMENT chiusi, exit0 insufficiente, toolcall inattesa invalida risultato. Test malformato/quota/overflow/capability in `tests/contract/discovery-codex.test.ts`, con errore safe e output parziale senza falso completamento.
- [X] T023 [US1] Completare provider configure/check, preview/show/discard, prepare/start e query operation headless in `src/cli/discovery.ts` e `src/client/local-client.ts`; leggere scope/intent file soltanto nella CLI fidata, non accettare prompt/argv arbitrari. runDiscovery osserva admission o richiesta originale, senza polling LLM del registro; verificare invocazioni/UNKNOWN_OUTCOME in `tests/integration/discovery-cli-start.test.ts`.
- [X] T024 [P] [US1] Scrivere `apps/desktop/tests/contract/discovery-bridge.test.ts`, `apps/desktop/tests/integration/discovery-receipts.test.ts` e `apps/desktop/tests/e2e/discovery-start.spec.ts`: picker opaco, sender/main-frame/origine/epoch/store, DTO/cap input, conferma annullata/scaduta, ricevuta prima dell’effetto, perdita risposta e nessun fallback al namespace project. Niente credenziali/provider nel renderer.
- [X] T025 [US1] Implementare API nominate e namespace ricevute Discovery in `apps/desktop/src/shared/discovery-contract.ts`, `apps/desktop/src/shared/bridge-contract.ts`, `apps/desktop/src/shared/validation.ts`, `apps/desktop/src/preload/index.cts`, `apps/desktop/src/main/discovery.ts`, `apps/desktop/src/main/ports.ts`, `apps/desktop/src/main/core-cli.ts`, `apps/desktop/src/main/action-handlers.ts`, `apps/desktop/src/main/receipt-store.ts`, `apps/desktop/src/main/operation-recovery.ts` e `apps/desktop/src/main/index.ts`. Main passa solo CLI allowlist; conferma UI60s e grant core5min distinti; ricevute metadata≤4KiB/max100, query namespace originale, nessun testo/secret/path provider replayabile.
- [X] T026 [US1] Costruire pannello avvio in `apps/desktop/src/renderer/views/ProjectDetail.tsx`, `apps/desktop/src/renderer/views/Discovery.tsx`, `apps/desktop/src/renderer/components/DiscoveryLaunch.tsx` e `apps/desktop/src/renderer/state/discovery.ts`: provider/modello, scope≤16, preview/copertura/omissioni/byte, consenso invio, identità e distinzione accettato/completato. Non installare o autenticare automaticamente; mostrare blocco motivato e istruzioni login ufficiale. Tastiera/focus/errori inclusi nel flusso iniziale.
- [X] T027 [US1] Comporre porte e servizio in `src/bootstrap.ts`, `src/core/daemon-main.ts`, `src/core/runtime.ts` e `src/core/discovery/dispatch.ts`; pubblicare discoveryVersion/metodi disponibili, lasciare registry/letture storiche utilizzabili se Discovery non inizializzata/UNSAFE. Verificare start esplicito schema4 e headless privo di Electron in `tests/integration/discovery-bootstrap.test.ts`; confermare che apertura UI/dettaglio non invoca modello.
- [ ] T028 [US1] Preparare ed eseguire, soltanto con opt-in autorizzato, G1 in `tests/acceptance/discovery-real-provider.test.ts` e registrare evidenze in `specs/004-project-discovery/reports/provider-qualification.md`: login ufficiale Keychain nel CODEX_HOME dedicato, pin/profilo/modello reali, un avvio UI e riscontro headless, repository scratch invariato e nessun file token. Guard env esplicita prima di qualsiasi effetto, skip dichiarato senza consenso/account; nessuna chiamata nel normale npm test o sostituzione con fake. G1 NOT_RUN non equivale a integrazione reale completata.

**Checkpoint US1/G1**: avvio locale verificato e percorso reale qualificato separatamente. È un primo checkpoint tecnico; da solo non offre ancora la Discovery completa utile del brief.

## Phase 4: US2 — Seguire l’analisi e rispondere all’architetto (P1)

**Obiettivo**: output/intervista persistenti, risposta intenzionale, chiusura client innocua e cancel/recovery verificabili.
**Prova indipendente**: fixture QUESTIONS, chiusura/riapertura UI, stessa Discovery e domanda, risposta applicata una volta e nuovo run esplicito; fault mirati senza credenziali.

- [X] T029 [P] [US2] Scrivere `tests/integration/discovery-interview.test.ts`: domanda durevole, risposta ANSWER/UNKNOWN/correzione append-only e provenienza, UUID duplicato/payload differente, max20domande/20turni/4KiB, zero processi in WAITING_USER ma slot occupato. La risposta crea una sola nuova esecuzione con corpus originale rivalidato, non resume proprietario né maggiori permessi.
- [X] T030 [P] [US2] Scrivere `tests/contract/discovery-output.test.ts` e `tests/integration/discovery-events.test.ts` per chunk raw8KiB/envelope32KiB, watermark atomico con outbox, sequenze/cursori/replay esistenti e journal di soli metadata. Coprire output conservato4MiB/run, overflow/troncamento visibile, consumer lento/disconnesso e quota terminale con fixture brevi; nessuna nuova campagna di volume.
- [X] T031 [US2] Implementare domanda/risposta/continuazione in `src/core/discovery/interview.ts`, con CAS domanda/stateRevision e grant in `src/core/discovery/operations.ts`; salvare risposta prima del nuovo intento, comporre storia portabile e rivalidare input/provider/config per ogni run. Rifiutare vecchio contesto senza inviare nuovi dati col grant precedente, senza loop o retry automatici; QUESTION IDs assegnati solo dal core.
- [X] T032 [US2] Implementare pubblicazione output normalizzato e pagine in `src/core/discovery/read.ts`, `src/storage/discovery-artifacts.ts`, `src/storage/discovery-store.ts`, `src/protocol/events.ts`; estendere allowlist metadata desktop in `apps/desktop/src/shared/activity-contract.ts`. Nessun testo/domanda/corpus nel journal; pubblicare solo chunk registrati/hash-validati, distinguere dati parziali e diagnostic safe. Riutilizzare stream/replay/ACK003, senza stream token aggiuntivo.
- [X] T033 [US2] Implementare riconciliazione startup, cancel e stop in `src/core/discovery/recovery.ts`, `src/core/discovery/lifecycle.ts`, `src/core/runtime.ts` e `src/core/daemon-main.ts`: bloccare nuove admission durante drain/reconcile, verificare challenge/proof/generation, preservare WAITING_USER e output, nessun auto-resume. Storage failure/crash non liberano slot senza prova; stop core10s/UI12s invariati, errore BLOCKED/UNKNOWN se cessazione non verificata. Testare fault nel percorso reale locale con `tests/integration/discovery-recovery.test.ts` prima di dichiarare il checkpoint.
- [X] T034 [US2] Completare list/show/output/questions/answer/cancel/operation in `src/cli/discovery.ts`, `src/client/local-client.ts` e `src/core/discovery/dispatch.ts`, con query originale e stati distinti; verificare consultazione headless/offline di domande/output dopo restart in `tests/integration/discovery-cli-interview.test.ts`. Cancel locale verificato non è cancellazione remota verificata.
- [X] T035 [US2] Implementare vista output/intervista/cancel in `apps/desktop/src/renderer/views/Discovery.tsx`, `apps/desktop/src/renderer/components/DiscoveryInterview.tsx`, `apps/desktop/src/renderer/state/discovery.ts` e collegamento Operazioni in `apps/desktop/src/main/operation-recovery.ts`: polling≤1/s solo visibile/non sovrapposto, FIFO500righe/1MiB, testo inerte e troncamento, UUID e recovery senza Retry cieco. Cambio vista/archivio cancella soltanto letture client; verificare con `apps/desktop/tests/e2e/discovery-interview.spec.ts` domanda persistente, UNKNOWN, tastiera e riapertura.
- [X] T036 [US2] Qualificare G2 in `tests/integration/discovery-lifecycle.test.ts` e `apps/desktop/tests/e2e/discovery-recovery.spec.ts` con host e provider fixture come veri processi locali: chiusura UI, SIGKILL daemon/host, provider errore/timeout controllato, risposta persa, cancel in RUNNING/WAITING_USER e PID estraneo/unknown preservato. Registrare conteggio run/identità/output/domande superstiti e prove stop in `specs/004-project-discovery/reports/validation.md`; nessuna attesa reale di10min.

**Checkpoint US2/G2**: stesso lavoro interrogabile dopo riapertura, intervista continuabile intenzionalmente e nessuna duplicazione/kill estranea dopo fault. G1 ancora NOT_RUN lascia aperta la qualifica reale, ma non impedisce questi test locali indipendenti.

## Phase 5: US3 — Rivedere e approvare la conoscenza (P1)

**Obiettivo**: revisioni strutturate e correggibili, approvazione precisa e idoneità attuale applicate dal core.
**Prova indipendente**: documento fixture con evidenze/risposte/ipotesi/UNKNOWN, correzione→nuova revisione, approvazione esplicita e query idoneità; un client alternativo non approva revisioni assenti/incomplete/stale.

- [X] T037 [P] [US3] Scrivere in `tests/unit/discovery-documents.test.ts` e `tests/integration/discovery-revisions.test.ts` casi tre sezioni obbligatorie, max20sezioni/200claim/256KiB, CODE sourceId/hash/range/citazione, USER_CONFIRMED answerId/revision, HYPOTHESIS/UNKNOWN/NOT_APPLICABLE distinti. Rifiutare schema/riferimenti inventati, risultato troncato o mancante; nuova revisione append-only con parent, senza attribuire verità semantica automatica alla provenance.
- [X] T038 [P] [US3] Scrivere `tests/contract/discovery-approval.test.ts` e `tests/integration/discovery-eligibility.test.ts`: agent exit0 non approva, grant assente, domanda aperta/UNKNOWN non accettato, document/config/state/context mismatch, progetto errato/rimosso, offline/errore/fingerprint incerto e revisione precedente negano approvazione/idoneità. Includere modifica byte/untracked immediatamente prima di approvare e test client headless alternativo contro bypass UI.
- [X] T039 [US3] Implementare validazione/pubblicazione bundle e correzioni in `src/domain/discovery/documents.ts`, `src/core/discovery/review.ts` e `src/core/discovery/interview.ts`; committare revisione solo dopo artefatto valido e uscita provata, liberare slot a READY_FOR_REVIEW soltanto allora. Correzione autorizzata riacquisisce slot e genera nuovo run/revisione senza mutare quella approvata né ereditare la sua approvazione; documenti soltanto nell’archivio.
- [X] T040 [US3] Implementare approval CAS, UNKNOWN accettati esplicitamente e idoneità con fingerprint corrente in `src/domain/discovery/approval.ts`, `src/core/discovery/review.ts`, `src/core/discovery/read.ts` e `src/storage/discovery-store.ts`. Eligibility readonly asincrona≤30s: CHECKING/false, max1check/progetto/4globali/no coda, checkId scoped con checkedAt/TTL30s, poll dello stesso risultato, nessun cache=true offline/dopo restart; futura API feature dovrà rivalidare. Nessuna falsa atomicità filesystem+DB e nessuna API creazione feature.
- [X] T041 [US3] Completare correct/document/approve/eligibility e pagine reader in `src/cli/discovery.ts`, `src/client/local-client.ts`, `src/core/discovery/dispatch.ts` e `src/storage/readonly-database.ts`; verificare documento256KiB via chunk senza superare frame/cap stdout in `tests/integration/discovery-cli-review.test.ts`. `eligibility PROJECT --check-id UUID` interroga lo stesso controllo, nessun nuovo job o effetto provider.
- [ ] T042 [US3] Implementare `apps/desktop/src/renderer/views/DiscoveryReview.tsx` e collegamenti in `apps/desktop/src/renderer/views/Discovery.tsx`, `apps/desktop/src/renderer/state/discovery.ts`, `apps/desktop/src/main/discovery.ts`: sezioni/provenienza/fonti relative/righe, revisione/digest/contesto, correzione, accettazione UNKNOWN distinta e Approva questa revisione. Caricare bundle bounded a chunk, rendere testo inerte senza link eseguibili; testare tastiera/focus/errori con `apps/desktop/tests/e2e/discovery-review.spec.ts`.
- [ ] T043 [US3] Qualificare G3 in `tests/acceptance/discovery-review.test.ts` e `apps/desktop/tests/e2e/discovery-approval.spec.ts`: flusso completo provider fixture→domanda→risposta→bozza→correzione→approvazione→eligibility, vecchia revisione e client alternativo negati. Controllare accesso headless e offline alle revisioni, nessun export Git/azione codice e repository invariato; conservare evidenze redatte in `specs/004-project-discovery/reports/validation.md` senza presentarle come SC-001 reale.

**Checkpoint US3/G3**: primo flusso funzionale completo, con freshness già obbligatoria prima di ogni run/approvazione/idoneità. La priorità P2 di US4 non permette di rinviare questi controlli di sicurezza.

## Phase 6: US4 — Aggiornare senza perdere lo storico (P2)

**Obiettivo**: rendere esplicita l’obsolescenza e avviare una nuova Discovery intenzionale conservando identità, documenti e approvazioni originali.
**Prova indipendente**: approvare una fixture, modificare input/config/identità, interrogare di nuovo e ottenere STALE/false; nuova Discovery senza trasferire approvazioni dopo reimport o cambio archivio.

- [X] T044 [P] [US4] Scrivere `tests/integration/discovery-freshness.test.ts`: byte dirty/untracked, aggiunta/rimozione nello scope directory, HEAD/branch/unborn, anchor/config/provider revision e documento diverso; modifica fuori da lista file esplicita non viene dichiarata coperta. Cambi durante run o prima di approval rendono risultato tardivo non corrente/rifiutato, mai applicato ad altra generazione/progetto.
- [ ] T045 [P] [US4] Scrivere `tests/contract/discovery-eligibility-checks.test.ts` e `apps/desktop/tests/unit/discovery-epoch.test.ts`: checkId altro store/progetto/scaduto, polling senza nuovo job, max1/4 check/no coda, timeout/restart/errore false, nuova richiesta senza ID rivalida. Callback e pagine vecchie dopo cambio archivio/progetto/revisione sono scartate, anche se il vecchio stato era APPROVED.
- [ ] T046 [US4] Completare invalidazione/fencing in `src/core/discovery/context.ts`, `src/core/discovery/review.ts`, `src/core/discovery/launch.ts` e `src/core/discovery/recovery.ts`: stato STALE o UNKNOWN motivato, grant invalidi dopo cambi rilevanti, nuovo preview/consenso per nuovo corpus, late result confinato alla generazione originale. Mantenere approvazione storica consultabile senza farla valere per il contesto corrente; test T038/T044/T045 PASS prima di consentire nuovo utilizzo.
- [ ] T047 [US4] Implementare nuova Discovery esplicita e consultazione storia in `src/core/discovery/operations.ts`, `src/core/discovery/read.ts`, `src/storage/discovery-store.ts`, `src/cli/discovery.ts`; nuovo requestId/discoveryId/snapshot e grant, nessuna adozione implicita o trasferimento su reimport. Verificare identità originale con `tests/integration/discovery-project-identity.test.ts`, inclusi rimozione, reimport dello stesso path e archivio diverso.
- [ ] T048 [US4] Completare stato Da aggiornare/UNKNOWN, nuova anteprima/Discovery e storico in `apps/desktop/src/renderer/views/ProjectDetail.tsx`, `apps/desktop/src/renderer/views/Discovery.tsx`, `apps/desktop/src/renderer/views/DiscoveryReview.tsx`, `apps/desktop/src/renderer/state/discovery.ts` e `apps/desktop/src/main/discovery.ts`. Mostrare checkedAt e contesto/versione storici, nessun forzare approvazione o Retry automatico; azioni e risposte bound a epoch/store/project/discovery/run/revisione.
- [ ] T049 [US4] Qualificare G4 in `tests/acceptance/discovery-refresh.test.ts` e `apps/desktop/tests/e2e/discovery-refresh.spec.ts`: modifica input dopo approvazione→idoneità negata→nuova Discovery→nuova approvazione, risultato tardivo, remove/reimport e cambio archivio senza perdita o trasferimento storico. Documentare evidenze in `specs/004-project-discovery/reports/validation.md`, con snapshot repository invariati dalle sole azioni Maestro.

**Checkpoint US4/G4**: conservazione dello storico, obsolescenza visibile e nessuna approvazione trasportata implicitamente fra contesti o identità.

## Phase 7: Qualifica finale e documentazione

**Obiettivo**: dimostrare il flusso reale, controllare l’integrazione e dichiarare precisamente cosa è pronto e cosa resta aperto. Questi task consolidano verifiche già introdotte; non rinviano safety/recovery al termine.

- [ ] T050 Completare la prova opt-in SC-001 in `tests/acceptance/discovery-real-provider.test.ts` e `specs/004-project-discovery/reports/provider-qualification.md`: una fixture volutamente priva di un’informazione, UI→Codex reale→domanda→risposta→review→approvazione e riscontro headless, snapshot immutato, evidenze redatte senza richiedere una frase naturale specifica. Riutilizzare G1 se ancora valido, senza moltiplicare run inutili; se login/modello/consenso mancanti, NOT_RUN con causa e qualifica reale aperta, mai PASS da fixture o rilassamento della policy.
- [ ] T051 Consolidare privacy/accessibilità/limiti in `tests/contract/discovery-privacy.test.ts` e `apps/desktop/tests/e2e/discovery-accessibility.spec.ts`: canary sintetici assenti in argv/log/journal/ricevute/errori, nessun raw stderr, testo ostile inerte, tastiera nei flussi start/interview/review/approve/cancel, cap e troncamenti espliciti. Verificare i target30s/10min/2s/4s con clock/fault e misure pertinenti, distinguendo limiti progettuali e tempi osservati in `specs/004-project-discovery/reports/validation.md`; niente benchmark prolungato.
- [ ] T052 Eseguire build/typecheck/lint core e desktop e suite pertinenti esistenti secondo `specs/004-project-discovery/quickstart.md`; registrare comandi, piattaforma, conteggi effettivi, errori e NOT_RUN in `specs/004-project-discovery/reports/validation.md`. Verificare regressioni001–003, nessun driver SQLite/provider in Electron e letture offline. Non avviare bench:foundation o test reali implicitamente; ripetere test soltanto per cambi/fallimenti non risolti.
- [ ] T053 Aggiornare `README.md`, `specs/004-project-discovery/quickstart.md` e sezioni generate di `AGENTS.md` con comandi realmente disponibili, upgrade su start, distinzione archivio/progetto/Discovery, configurazione pin/modello/login ufficiale e limiti/cause/azioni recovery. Preservare manual additions e gate preesistenti; documentare opt-in reale e modalità headless senza mostrare credenziali o promettere capability non qualificate.
- [ ] T054 Chiudere tracciabilità e review in `specs/004-project-discovery/reports/release-readiness.md`, `specs/004-project-discovery/reports/validation.md` e `specs/004-project-discovery/tasks.md`: 15 scenari, FR-001…018, NFR-001…005, SC-001…007 e otto invarianti con evidenza o NOT_RUN/BLOCKED. Separare baseline automatica, G0, G1 reale, G2/G3/G4 e review umana; conservare aperti001/T082,001/T085,002/T093 e003/T054 se non qualificati dalla relativa procedura. Non marcare task/gate superati senza prova, non eseguire merge/push/release né fasi ulteriori.

## Dipendenze e ordine di esecuzione

```text
T001 → T002 → T003 → T004 [G0 PASS]
  → Foundation T005–T018
  → US1 T019–T028 [G1 reale distinto]
  → US2 T029–T036 [G2]
  → US3 T037–T043 [G3, freshness obbligatoria]
  → US4 T044–T049 [G4]
  → Qualifica T050–T054
```

- **Gate bloccante di sicurezza**: G0 non passato ferma tutte le storie dipendenti. È vietato sostituirlo con una prova benigna o allentare il profilo.
- **Qualifica reale**: T028/G1 e T050 richiedono opt-in. Se manca solo account/consenso, i task locali successivi indipendenti possono proseguire con provider fixture, ma questi task restano non completati e l’integrazione reale non è accettata. Un fallimento di sicurezza effettivo blocca invece l’uso del provider e richiede correzione/riqualifica, non la sola annotazione NOT_RUN.
- **Foundation**: T006 dopo T005; T008/T009 dopo T007 e T006; T010 dopo T009; T012 dopo T011 e T010; T014 dopo T013/T012; T016 dopo T015 e storage/context; T018 dopo T017 e porte/storage. I gruppi test condivisi non richiedono account/UI; non parallelizzare modifiche al writer/schema/protocollo comuni.
- **US1**: T019 precede T020–T023; T024 precede T025/T026. T027 integra core e client dopo T021–T026; T028 usa T027. T022 include i contratti parser prima del parser stesso. La configurazione read-only e il check non avviano un modello.
- **US2**: dipende dall’admission e runtime US1. T029/T030 prima di T031/T032; T033 integra recovery dopo entrambi, T034/T035 espongono le funzioni, T036 verifica il percorso completo. I test usano Discovery fixture per isolare la storia.
- **US3**: dipende da intervista/output US2; T037/T038 prima di T039/T040; T041/T042 dopo servizi, T043 integra. Il gate corrente non può attendere la fase P2.
- **US4**: dipende da revisioni/approval US3; T044/T045 prima di T046/T047/T048, T049 integra. Le fixture preapprovate rendono indipendente la prova senza chiamate reali.
- **Finale**: T050–T054 dopo storie locali. T051 consolida, senza sostituire le verifiche di sicurezza già obbligatorie nei checkpoint. Nessuna pubblicazione automatica a fine fase.

## Opportunità di parallelo

Sono marcati `[P]` 14 task di test su file distinti. Il parallelo è una possibilità operativa, non una richiesta di avviare altri agenti; rispettare sempre il prerequisito di fase e non modificare file comuni contemporaneamente.

| Fase/storia | Esempio di lavoro parallelo | Prerequisito |
|---|---|---|
| Foundation | T005 stato/intent · T007 schema/ledger · T011 artefatti · T013 contesto/Git · T015 API/reader · T017 host | G0 passato, contratti di design disponibili; implementazioni dopo i relativi test |
| US1 | T019 admission core · T024 bridge/ricevute/UI | Foundation completata; file dei test distinti |
| US2 | T029 intervista · T030 output/eventi | US1 locale completata, provider fixture |
| US3 | T037 documenti/provenance · T038 approval/eligibility | US2 locale completata, snapshot/domande fixture |
| US4 | T044 freshness sorgenti · T045 checkId/epoch | US3 locale completata, fixture approvata |

Implementazioni e integrazioni successive sono sequenziali quando condividono writer, protocollo, dispatcher, core-cli o viste. Non dichiarare indipendenti storie che operano sullo stesso lifecycle: l’indipendenza riguarda la prova ripetibile con fixture, non l’assenza di prerequisiti funzionali.

## Strategia incrementale

1. Qualificare G0 con dati sintetici; fermarsi se l’isolamento non è dimostrabile.
2. Costruire Foundation e provarla headless, senza costi/provider reale.
3. Consegnare US1 come checkpoint di avvio, con G1 distinto dai test automatici.
4. Aggiungere US2 e US3: **primo flusso utile completo** = analisi → intervista → review → approvazione, includendo già rivalidazione del contesto. Non chiamare MVP completato il solo spawn.
5. Completare US4 per aggiornamento/storico e identity fencing visibili all’utente.
6. Un percorso reale completo SC-001 e verifiche mirate bastano per la prima qualifica funzionale; registrare separatamente tempi osservati, target e gate esterni. Nessuna infrastruttura generica per futuri provider/agenti o campagna lunga aggiunta.

## Tracciabilità richiesta

### Scenari della specifica

| Scenario | Task di implementazione/verifica |
|---|---|
| US1.1 consenso e singola sessione identificabile | T019–T028 |
| US1.2 provider/auth/capability non disponibili | T002–T004, T019–T020, T022, T026, T028 |
| US1.3 doppio invio/Discovery occupata | T007, T009, T019, T021, T023–T025 |
| US1.4 dirty/conflitti/unborn in sola lettura | T013–T014, T019, T028 |
| US2.1 stato/output correlati | T030, T032, T034–T035 |
| US2.2 domanda persistente/risposta unica | T029, T031, T034–T036 |
| US2.3 chiusura e riapertura client | T024–T025, T033–T036 |
| US2.4 cancel/errore/restart senza falsi esiti | T017–T018, T022, T033, T036 |
| US3.1 sezioni/provenance/fonti | T037, T039, T041–T043 |
| US3.2 correzione e nuova revisione | T029, T031, T037, T039, T042–T043 |
| US3.3 approvazione precisa core | T038, T040–T043 |
| US3.4 idoneità negata se incompleta/non approvata/stale | T038, T040–T043 |
| US4.1 contesto/config/documento cambiati | T038, T040, T044–T046, T049 |
| US4.2 risultato tardivo non applicato al nuovo contesto | T017–T018, T033, T044, T046, T049 |
| US4.3 remove/reimport/cambio archivio | T024–T025, T045, T047–T049 |

### Requisiti e risultati

| Requisiti | Task responsabili |
|---|---|
| FR-001, FR-002 | T015–T016, T019–T028 |
| FR-003 | T002–T004, T006, T020, T022, T028 |
| FR-004, FR-018 | T001–T004, T011–T014, T020, T022, T025–T026, T032, T051 |
| FR-005, FR-006 | T005–T010, T017–T019, T021, T027, T029–T033, T036 |
| FR-007 | T011–T012, T015–T016, T030, T032, T034–T036 |
| FR-008 | T029, T031, T034–T037 |
| FR-009, FR-010 | T006, T022, T037, T039, T041–T043 |
| FR-011, FR-012 | T005–T006, T009–T010, T038–T043 |
| FR-013 | T013–T014, T021, T031, T038, T040, T044–T046, T049 |
| FR-014 | T024–T025, T033–T036, T045, T048–T049 |
| FR-015, FR-016 | T005–T010, T017–T018, T033–T036 |
| FR-017 | T006, T031, T039, T044–T049 |
| NFR-001, NFR-002 | T001, T006, T008, T015–T018, T023–T027, T034, T041, T052 |
| NFR-003 | T005, T011–T018, T022, T025, T029–T030, T032–T036, T037–T042, T045, T051 |
| NFR-004 | T002–T004, T019, T028–T030, T036–T038, T043–T045, T049–T050, T052 |
| NFR-005 | T024–T026, T035, T042, T048, T051 |
| SC-001 | T028, T050; mock end-to-end T043 non sostituisce il reale |
| SC-002 | T037, T039, T042–T043, T050 |
| SC-003 | T007, T009, T017–T019, T021, T024–T025, T029, T033–T036 |
| SC-004 | T038, T040–T049 |
| SC-005 | T002–T004, T013–T014, T019, T028, T036, T043, T049–T050 |
| SC-006 | T019–T020, T022, T026, T028, T030, T033, T035 |
| SC-007 | T024–T026, T035, T042, T048, T050–T051 |

### Invarianti costituzionali

| Invariante | Task di protezione principali |
|---|---|
| I Local-first | T008–T012, T015–T016, T034, T041, T043 |
| II Core headless/client | T001, T006, T016, T023–T027, T034–T036, T041 |
| III Provider agnostic | T002–T006, T020, T022, T028–T031, T050 |
| IV Git safety | T002–T004, T013–T014, T019, T028, T036, T043, T049–T050 |
| V Recovery | T005–T012, T017–T019, T021, T024–T025, T029–T036, T044–T049 |
| VI Approvazioni esplicite | T005–T010, T019–T021, T024–T026, T031, T038–T049 |
| VII Testabilità | test prima delle implementazioni in ogni fase; T001, T002, T028, T050, T052 |
| VIII Osservabilità | T009–T012, T015–T016, T022, T025, T030, T032–T036, T041, T051–T054 |

Worktree/merge/cleanup/installazioni/release/failover sono N/A per004, come motivato nel piano. Nessun test di queste funzionalità future viene introdotto.
