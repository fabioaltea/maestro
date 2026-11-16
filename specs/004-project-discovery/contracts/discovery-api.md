# Contract — Discovery CLI / local IPC v1

Estende lo stesso trasporto autenticato del daemon e PublicResult protocolVersion1. Nessun nuovo endpoint HTTP o servizio. Campo capability `discoveryVersion:1` e metodi disponibili in daemon status; vecchio core/UI o schema<4 → funzionalità non disponibile, niente fallback fittizio.

## CLI e metodi

Ogni comando usa `--state-dir ABS --json`. Mutazioni con `--request-id UUID`; query operation usa UUID originale. Gli esempi sono comandi futuri, non eseguiti nel planning.

| CLI `maestro discovery ...` | Metodo locale | Input essenziale |
|---|---|---|
| provider get | discovery.provider.get | nessuno; config/capability/ultimo check senza segreti |
| provider configure --binary ABS --model ID --grant UUID | discovery.provider.configure | grantId, native path/hash/version/profile, expectedProviderRevision |
| provider check | discovery.provider.check | configurazione attesa; probe locale intenzionale, nessun modello/login |
| preview PROJECT --scope-file FILE | discovery.preview | projectId/configRevision,≤16selettori relativi; scope-file letto solo dalla CLI e serializzato in DTO chiuso |
| preview show SNAPSHOT | discovery.preview.get | snapshotId, metadata/copertura/omissioni; source page separata |
| preview discard SNAPSHOT | discovery.preview.discard | snapshotId/revisione, nessun riferimento attivo |
| prepare --intent-file FILE | discovery.prepare | action, DTO canonico, expected revisions/digests |
| start PROJECT --grant UUID | discovery.start | grantId, snapshotId, projectId/configRevision/providerRevision; niente prompt/argv arbitrari |
| list PROJECT [--cursor C] | discovery.list | projectId,limit≤20,cursor |
| show DISCOVERY | discovery.get | discoveryId |
| output RUN [--after C] | discovery.output.list | runId,cursor,limit≤20; chunk raw8KiB |
| questions DISCOVERY | discovery.questions.list | discoveryId,limit≤20,cursor |
| answer QUESTION --answer-file FILE --grant UUID | discovery.answer | questionId/expectedRevision,kind ANSWER/UNKNOWN, testo≤4KiB,grantId |
| correct DISCOVERY --correction-file FILE --grant UUID | discovery.correct | discoveryId/documentRevision/stateRevision,correzione≤4KiB,grantId |
| document REVISION [--after C] | discovery.document.get | revisionId,cursor; metadata oppure chunk8KiB |
| approve DISCOVERY --revision UUID --grant UUID | discovery.approve | revisionId,bundleDigest,contextDigest,config/state revision,acceptedUnknownIds,grantId |
| cancel DISCOVERY --grant UUID | discovery.cancel | expectedStateRevision,grantId |
| eligibility PROJECT [--check-id UUID] | discovery.eligibility.get | projectId,checkId?; rivalidazione corrente, non flag cached |
| operation REQUEST | discovery.operation.get | requestId |

CLI prepare stampa riepilogo/ambito/hash/scadenza; operatore conferma intenzionalmente usando grant con la stessa richiesta. UI usa prepare/confirm e ricevuta propria. `provider configure` accetta file path soltanto dal client headless fidato; il renderer usa un handle native-picker risolto main. Nessuna chiave/token accettata come parametro.

## Autorizzazione e idempotenza

Core prepare genera grant monouso TTL5min legato a ownerUid/store/action/target/snapshot/provider/modello/revisioni/digest canonico. Non è un’autenticazione alternativa; trasporto e policy core si applicano sempre. Consumo grant, operation UUID, slot e intenzione esterna sono transazionali. Retry con stesso requestId/hash recupera il risultato originale anche se il grant risulta consumato dalla stessa richiesta; intento diverso → IDEMPOTENCY_CONFLICT. Collisione altro namespace → IDEMPOTENCY_CONFLICT, nessun effetto.

`preview` è una preparazione locale intenzionale, senza provider: contiene scope e identità, ha UUID proprio, salva soltanto artefatti privati e restituisce operation finché completa (≤30s). Metadata preview/prepare elencano invio al provider, copertura e limiti PRIMA del consenso. Se contesto cambia prima del consumo → CONTEXT_CHANGED, nessun nuovo corpus con grant precedente. Discard elimina solo preview non referenziata, scaduta o annullata esplicitamente, con prova di proprietà; mai sorgenti o risultati di sessione.

## Esiti e tempi

PublicResult esistente, `data.operation` Discovery contiene `{requestId,action,phase,outcome,acceptedAt,completedAt,result,error}`. Mutazioni normalmente restituiscono admission `{accepted,requestId,discoveryId,sessionId,runId?,stateRevision}` entro2s, senza attendere il modello. `operation.outcome=SUCCEEDED` per start significa sessione accettata, non agente concluso; `data.discovery.state` è l’autorità del lifecycle. LocalClient.runDiscovery osserva admission o UUID originale, non copia il polling30s del registro aspettando il LLM.

Risposta persa dopo possibile invio → UNKNOWN_OUTCOME con requestId; interrogare operation, mai nuovo start automatico. NOT_FOUND non prova non-invio. Letture normali2s; preview/fingerprint/revalidation sono operazioni esplicite bounded30s, con query di stato; eligibility può ritornare CHECKING e un checkId, sempre eligible=false finché verifica completata. Un client non attende sincronicamente30s su un trasporto read2s.

## Pagine e letture offline

Envelope codificato≤32KiB anche nel reader; frame64KiB invariato. Chunk8KiB raw/base64, hash e byteLength espliciti; cursori opachi bindati a store,target,revision,offset; limit20 metadata e cap effettivo byte, senza troncare un record. Il corpus non viene trasferito in un unico envelope. Core valida hash dell’artefatto prima di ogni pagina.

List/get/questions/output/document/operation e provider configuration sono leggibili offline come LAST_KNOWN tramite reader confinato. Nessun probe provider, filesystem source, upgrade, repair o login da lettura storica. Offline eligibility eligible=false/UNKNOWN, pur mostrando l’approvazione storica. I path di oggetti/credenziali/host non sono pubblici.

## Eventi

Journal globale: `discovery.changed`, `discovery.output.available`, `discovery.question.available`, `discovery.document.changed`, `discovery.approval.changed`, payload chiuso di soli projectId/discoveryId/sessionId/runId/revisionId/operationId, stato, safe code e watermark. Nessun testo, source path, prompt, risposta, token o documento. Transizione e outbox stessa commit. Eventi invalidano la vista; contenuti tramite pagine. Core/desktop allowlist estese insieme, scope=`discovery`, seq globale e replay/ACK003 invariati.

## Errori nuovi

PROVIDER_NOT_CONFIGURED, PROVIDER_AUTH_REQUIRED, PROVIDER_UNSUPPORTED, PROVIDER_UNSAFE, PROVIDER_UNAVAILABLE, PROVIDER_QUOTA, PROVIDER_PROTOCOL_ERROR, PROVIDER_OUTPUT_LIMIT, PROVIDER_CONTEXT_LIMIT, DISCOVERY_NOT_INITIALIZED, DISCOVERY_BUSY, DISCOVERY_LIMIT, CONTEXT_CHANGED, CONTEXT_UNSTABLE, CONTEXT_LIMIT, SOURCE_EXCLUDED, ARTIFACT_CORRUPT, APPROVAL_REQUIRED, APPROVAL_STALE, ANSWER_CONFLICT, CHECK_EXPIRED. SafeError statici con nextAction; nessun raw stderr/stack/provider payload. Errori Foundation/Project esistenti restano distinti.

### Preview, grant e check asincroni

configure/start/answer/correct/approve/cancel consumano il grant core. preview,
provider.check e preview.discard sono azioni locali esplicite autenticate con UUID
e validazione dello scope/proprietà, senza grant remoto; non invocano inferenza.
`discovery.prepare` non è esecuzione ed è bounded, max32grant attivi/servizio.

`eligibility.get {projectId}` crea/coalesca un controllo locale readonly bounded30s
(max1per progetto/4globali, niente coda) e risponde CHECKING/checkId/eligible=false.
`{projectId,checkId}` recupera quel risultato con checkedAt; scade dopo30s, ID di
altro store/progetto o scaduto → CHECK_EXPIRED/INVALID_REQUEST e eligible=false.
Una nuova richiesta senza ID rivalida; nessun booleano cached diventa autorizzazione
per la futura creazione feature, che dovrà verificare di nuovo. Offline niente
creazione di check e nessun eligible=true. Il checkId è osservazione transitoria,
non un’operazione mutativa/provider né un dato persistito che sopravvive al restart.
