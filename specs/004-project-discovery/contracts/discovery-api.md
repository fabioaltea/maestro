# Contract — Discovery CLI / local IPC v1

Estende lo stesso trasporto autenticato del daemon e PublicResult protocolVersion1. Nessun nuovo endpoint HTTP o servizio. Campo capability `discoveryVersion:1` e metodi disponibili in daemon status; vecchio core/UI o schema<4 → funzionalità non disponibile, niente fallback fittizio.

## Disponibilità incrementale T016

Implementate e pubblicate nelle capability soltanto le letture provider.get,
preview.get, list, get, questions.list, output.list, document.get e operation.get.
La tabella seguente descrive il contratto completo, che verrà completato dai task
successivi. Provider.get restituisce configurazione pubblica e check=null finché
manca il servizio di verifica; non deduce login o capacità dal record persistito.
Eligibility offline restituisce false/UNKNOWN senza creare check.

Preview.get con `{snapshotId,sources:true,limit?,cursor?}` legge una pagina fonti
senza trasferire corpus o path privati. Document.get con `{revisionId}` legge
metadata/approval storica; `{revisionId,content:true,cursor?}` legge un chunk raw8KiB
in base64. La CLI document usa contenuti per default, `--metadata` per i soli
metadata. Preview show usa `--sources` per la pagina fonti.

## Disponibilità incrementale T027

Il daemon compone ora provider/configurazione/check, preview/discard, prepare
e start con runtime posseduto e artefatti nello stesso writer. Le capability
annunciano questi metodi oltre alle letture; un dispatch senza servizio resta
read-only. Provider.get espone requisiti pubblici pin/profilo e ultimo check
solo cached, senza probe da consultazione. Schema4 solo su start esplicito.
Admission sospesa durante recovery/drain; identità non riconciliata mantiene
RECONCILING e blocca nuove mutazioni senza impedire registro o storia.

Questo checkpoint collega l'avvio, non completa US2/US3. La pubblicazione dei
risultati strutturati viene installata con intervista/review: fino ad allora
un risultato parsato non diventa una domanda/documento approvabile (rifiuto
PROVIDER_UNSUPPORTED dopo uscita verificata). Output/intervista/review, recovery
completa T033 e G1 reale restano aperti. Nessuna prova modello reale da questa
composizione; non presentare il solo spawn come Discovery utile completata.

## CLI e metodi

Ogni comando usa `--state-dir ABS --json`. Mutazioni con `--request-id UUID`; query operation usa UUID originale. Gli esempi sono comandi futuri, non eseguiti nel planning.

| CLI `maestro discovery ...` | Metodo locale | Input essenziale |
|---|---|---|
| provider get | discovery.provider.get | nessuno; config/capability/ultimo check senza segreti |
| provider configure --binary ABS --model ID --grant UUID | discovery.provider.configure | requestId,grantId,binaryRealpath,modelId; hash/versione/profilo/revisione attesa risolti dal grant |
| provider check --expected-provider-revision REV | discovery.provider.check | requestId,expectedProviderRevision; probe locale intenzionale, nessun modello/login |
| preview PROJECT --expected-revision REV --scope-file FILE | discovery.preview | requestId,projectId,expectedConfigRevision,≤16selettori relativi; scope-file JSON array letto solo dalla CLI |
| preview show SNAPSHOT | discovery.preview.get | snapshotId, metadata/copertura/omissioni; source page separata |
| preview discard SNAPSHOT | discovery.preview.discard | requestId,snapshotId immutabile; nessun riferimento attivo |
| prepare --intent-file FILE | discovery.prepare | action, DTO canonico, expected revisions/digests |
| start PROJECT --grant UUID | discovery.start | requestId,grantId,projectId; snapshot/config/provider/modello risolti dal grant, niente prompt/argv arbitrari |
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

Il core risolve l’intent canonico conservato nel grant per start/configure e
confronta progetto oppure binario/modello richiesti prima di consumarlo. Il
client non deve persistere un secondo intent per confermare. Gli input file CLI
sono regolari, UTF-8, bounded32KiB e stabili durante la lettura; non vengono
trasmessi path di scope-file/intent-file al daemon. Nessun flag è accettato da
comandi cui non appartiene. Le ricevute incerte preservano UUID e azione, senza
scambiare un’operazione Discovery di altro tipo per il risultato richiesto.

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


### T034 — intervista/cancel headless

answer QUESTION --answer-file FILE --grant UUID legge JSON chiuso {kind,text}
UTF-8≤4KiB per testo; --answer-stdin è alternativa al file, entrambi bounded32KiB
e nessuna risposta in argv. Target/testo/kind devono corrispondere al grant,
revisioni e answerId sono risolti dall'intent core. cancel DISCOVERY --grant
UUID usa il grant scoped a stato/snapshot. Entrambi restituiscono admission e
UUID originale; operation interroga l'esito, senza un nuovo run automatico.
Questions include l'ultima risposta confermata per ciascuna domanda (o null),
con revisione/kind/testo; resta leggibile offline con output e stato storici.
