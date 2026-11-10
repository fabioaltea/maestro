# Contract — Local Project Registry API v1

Estensione del trasporto UDS autenticato Foundation, protocolVersion=1 e frame
NDJSON ≤64 KiB. Nessun HTTP, porta TCP o nuovo servizio. Metodi/payload/errori
aggiunti esplicitamente alle allowlist e aggiornati insieme ai client di questa build.

## Capability e autorizzazione

`status.get` aggiunge `capabilities.projectRegistryVersion=1` e stato di capacità
Git/inspection senza path o ambiente. La capacità è rilevata nel bootstrap/qualificazione
e conservata: status e query non avviano Git implicitamente. Assenza della capability significa feature
non disponibile; client non inviano mutazioni a un vecchio daemon. Non si richiede
compatibilità automatica con vecchi binari; journal storico Foundation resta leggibile.

Handshake, credenziale locale e controllo UID restano Foundation. Nuovi metodi
richiedono role=client; role=controller non acquisisce poteri registry. Mutazioni
solo RUNNING con admission aperta. Anche chi possiede una credenziale client deve
fornire azione/progetto/revisione coerenti: non può invocare internal.prepareStop.
Il core non si fida di prevalidazioni CLI, nome progetto o dati del repository.

La richiesta esplicita è autorizzazione per la sola azione e revisione indicate;
non viene introdotto un ulteriore prompt o token approvazione. REGISTER autorizza
solo salvataggio del contesto, REMOVE solo tombstone, VERIFY sola osservazione.
Nessuna autorità implicita a Discovery, cancellazione file o esecuzione codice.
La separazione UID Foundation non è una sandbox contro processi ostili dello stesso UID.

## Envelope e metodi

RpcRequest Foundation: `{protocolVersion:1, correlationId:UUID, method, params}`.
correlationId identifica il tentativo di trasporto; requestId dentro params identifica
l'intento durevole e può essere riusato con nuovi correlationId.
Campi extra/non riconosciuti rifiutati; UUID e decimali validati senza coercizioni.

| Metodo | Params | Dato di risposta |
|---|---|---|
| projects.register | requestId, path assoluto, name? string, baseBranch? string | AcceptedOperation o esito originale |
| projects.list | limit? 1..100 default 25, cursor? | ProjectSummary[], registryRevision, nextCursor? |
| projects.get | projectId | ProjectDetail e ultima osservazione datata |
| projects.verify | requestId, projectId | AcceptedOperation o esito originale |
| projects.update | requestId, projectId, expectedRevision, patch | AcceptedOperation o esito originale |
| projects.remove | requestId, projectId, expectedRevision | AcceptedOperation o esito originale |
| projects.operation.get | requestId | Stato pending o risultato terminale persistito |

`patch` ha almeno un campo tra name e baseBranch; baseBranch=null rimuove soltanto
la scelta configurata, stringa la imposta previa verifica; omissione la conserva.
REGISTER distingue omissione base da input esplicito: null/vuoto non sono alias
silenziosi di omissione. Il client converte il path relativo in assoluto prima
all'invio; i retry usano l'intento originale, non un path ricalcolato da altro cwd.

Ogni risposta usa result OK/BUSY/BLOCKED/ERROR/UNKNOWN_OUTCOME e il modello Foundation.
AcceptedOperation: requestId, accepted=true, outcome=IN_PROGRESS, pollMethod;
trasporto result=BUSY per IN_PROGRESS secondo Foundation. Una coda piena restituisce
BUSY con accepted=false: nessuna promessa di completamento. Anche UPDATE/REMOVE
possono concludere dopo la risposta di admission. Il client può attendere tramite
poll con backoff 50–250 ms su connessioni brevi; nessun nuovo stream di workflow.

Il terminale contiene action, requestId, projectId se noto, outcome, effect
CREATED/EXISTING/UPDATED/OBSERVED/REMOVED/NONE, configRevision/observationRevision
se applicabili, completedAt e safe error. Un retry restituisce lo snapshot originale,
non una nuova vista del progetto; il client usa projects.get per lo stato corrente.

## Query e consistenza

List/get ritornano configurazione confermata e osservazione salvata con completedAt,
observedConfigRevision, referenceCheckout e freshness dell'osservazione LAST_KNOWN.
Freshness LIVE dell'envelope significa lettura viva del registro, non nuovo Git probe.
Usare i campi nullable del modello per distinguere UNKNOWN da false/clean.
Nome, path e branch sono dati per client autenticato, mai automaticamente loggati.
I DTO pubblici non espongono anchor inode/volume o canonical_intent del ledger.

Lista ordinata per projectId stabile, senza tombstone. Cursor opaco vincolato a
storeId, registryRevision e lastProjectId, non riutilizzabile in altro archivio.
Pagina ≤60 KiB comprensiva di JSON e record intero; count ≤100. Se il registro cambia
fra pagine, REGISTRY_CHANGED con nextAction=restart-list, senza snapshot lungo o dati
misti. Un singolo record fuori budget produce OUTPUT_LIMIT, non troncamento silenzioso.
Raccolte di 100 progetti possono richiedere più pagine: misurare il tempo dell'intera
lettura richiesta, non solo della prima pagina, nel carico SC-002.

Get progetto rimosso restituisce PROJECT_REMOVED con ID/revisione tombstone;
ID sconosciuto PROJECT_NOT_FOUND. Operation query può leggere l'esito della rimozione
anche dopo una nuova registrazione dello stesso repo. Un requestId mai accettato
restituisce OPERATION_NOT_FOUND; non è un risultato terminale né un progetto mancante.
`capabilities.projectRegistryMethods` elenca soltanto i metodi implementati nella
build corrente; il client verifica il metodo oltre alla versione.

Senza daemon, il client passa al core inspect readonly per list/get/operation,
con envelope LAST_KNOWN e liveness separata. Nessun autostart/upgrade/probe. Mutazioni
senza daemon falliscono DAEMON_UNAVAILABLE. Una lettura termina entro 2 s, dato o errore.
Store assente/incompatibile/non accessibile non viene sostituito con elenco vuoto.

## Errori strutturati

Ogni errore contiene code, category, retryable e nextAction allowlisted; nessuno
stderr Git/SQLite, sorgente, ambiente o URL remoto. L'errore trasporto può non avere
requestId accettato; il risultato persistito espone sempre il proprio requestId.

| Codici principali | Categoria | Retry / prossima azione |
|---|---|---|
| INVALID_REQUEST, INVALID_NAME, INVALID_BASE_BRANCH | VALIDATION | Correggere input; nuovo intento se quello precedente è terminale |
| UNAUTHORIZED, PATH_ACCESS_DENIED | AUTHORIZATION | Ripristinare accesso; nessun ampliamento automatico |
| REVISION_CONFLICT, IDEMPOTENCY_CONFLICT | CONCURRENCY | Rileggere configurazione / recuperare intento originale |
| OBSERVATION_SUPERSEDED, REGISTRY_CHANGED | CONCURRENCY | Rileggere e richiedere esplicitamente una nuova verifica / lista |
| REPOSITORY_NOT_FOUND, REFERENCE_CHECKOUT_UNAVAILABLE | RUNTIME | Rendere disponibile il percorso; non ricrearlo |
| REPOSITORY_UNSUPPORTED, GIT_UNAVAILABLE | RUNTIME | Installazione/versione/formato supportato, nessuna riparazione |
| REPOSITORY_CHANGED, REPOSITORY_UNSTABLE | SAFETY | Rileggere evidenze; nessun rebind automatico |
| INSPECTION_UNAVAILABLE, INSPECTION_UNSAFE | SAFETY | Verificare capacità/profilo; file status UNKNOWN, niente fallback insicuro |
| DEADLINE_EXCEEDED, UNKNOWN_OUTCOME | TIMEOUT | Query stesso requestId prima di nuovo intento |
| OUTPUT_LIMIT | RUNTIME | Osservazione non completa; ridurre carico o attendere supporto, mai clean fittizio |
| PERSISTENCE_UNAVAILABLE, STATE_CORRUPT, STATE_INCOMPATIBLE | PERSISTENCE | Diagnosi/ripristino esplicito; nessuna ricreazione |
| EVENT_BACKPRESSURE | OBSERVABILITY | Attendere/ripristinare drain, senza aggirare outbox |

PROJECT_NOT_FOUND/REMOVED, REGISTRY_NOT_INITIALIZED, STATE_ABSENT e
DAEMON_UNAVAILABLE sono categoria RUNTIME, con messaggi deterministici; non sono
successi vuoti. Per errori di input/concorrenza/runtime/outcome scaduto il terminale
è FAILED; errori SAFETY, autorizzazione o backpressure che richiedono intervento
sono BLOCKED; interruzione da stop/crash è INTERRUPTED. Un guasto di persistenza
può impedire il terminale: restituire UNKNOWN_OUTCOME con safe error di persistenza,
mai inventare un risultato durevole.
retryable indica possibilità di nuovo tentativo dopo l'azione suggerita, non retry
automatico di un nuovo intento. Se l'intento è già terminale, stesso ID torna quello.

## Eventi registry nello stesso journal

Riutilizzare operation.accepted/completed/failed/blocked. Per INTERRUPTED usare
operation.failed con outcome=INTERRUPTED. Campo operationId sempre requestId esplicito;
non ereditarlo da una concorrente operazione lifecycle. Envelope EventRecord v1,
stesso storeId, seq e cursor Foundation. instanceId è quello autore del commit.

Payload allowlisted aggiuntivo: scope=project, projectId? UUID, action
REGISTER/VERIFY/UPDATE/REMOVE, outcome enum, effect enum, configRevision? decimale,
observationRevision? decimale, code? allowlisted. ProjectId può mancare soltanto
prima dell'identificazione (admission o import fallito); evento terminale di una
mutazione confermata contiene sempre l'ID. RequestId resta nell'operationId envelope.
Nomi, path, ref name, remote, contenuti e stderr non entrano nel payload.

Aggiornare codec/redattore/test, non solo il tipo TypeScript. Rispettare evento
≤16 KiB, outbox ≤64 KiB, pagina ≤60 KiB, stream buffer ≤1 MiB e timeout Foundation.
Batch stato/esito/evento atomico. Errori precommit non diventano eventi di successo;
si può registrare un esito di fallimento se lo store funziona. Journal degradato dopo
commit è esplicito e non annulla il risultato durevole.

E1 prova persistenza/redazione; E2 replay, gap e storico misto; E3 live/disconnect;
V1 backpressure con mutazioni registry. Il client usa il medesimo cursor dopo aver
applicato il frame; non avanza su evento scartato o callback fallita. Nessuna nuova
retention o coda illimitata. Il polling degli esiti funziona anche con stream assente.
