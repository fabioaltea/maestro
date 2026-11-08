# Local protocol — v1

## Trasporto e autenticazione

NDJSON UTF-8 su socket Unix; nessun TCP. Directory 0700 e socket 0600 del proprietario.
LocalClient verifica directory, UID e descriptor; il core verifica capability prima del
dispatch. Hello contiene protocolVersion=1, token e clientNonce; il server risponde con
storeId, instanceId/controllerAttemptId, serverNonce e prova HMAC sul transcript con la
capability condivisa. Confronto constant-time; transcript e token mai registrati.
Ogni connessione è autenticata una volta; nonce diversi impediscono di scambiare un vecchio
hello per prova dell'identità corrente.

Frame massimo 64 KiB, evento massimo 16 KiB, stringhe/errori bounded. Frame oltre limite,
JSON non valido, metodo sconosciuto o major incompatibile ⇒ errore e chiusura senza effetti.
Handshake entro 1 s. Il server distingue connessione autenticata da autorizzazione
all'azione: letture e subscription non conferiscono una capacità di mutazione.

## Operazioni disponibili

La mutazione pubblica usa il bootstrap ControlExecutor documentato in lifecycle.md,
che funziona anche senza daemon. Il messaggio bootstrap contiene protocolVersion,
requestId, action=start|stop|restart e canonicalStateDir; l'identità è derivata dall'UID
reale del processo e dalla proprietà dell'archivio, mai da ownerUid dichiarato dal client.

Il controller espone il proprio socket privato mentre lavora. Daemon e inspect-core
espongono lo stesso formato delle risposte di lettura; inspect-core usa messaggi di sola
lettura su pipe e termina, senza mantenere un servizio alternativo permanente.

| Metodo | Destinatario | Parametri essenziali |
|--------|--------------|---------------------|
| status.get | daemon / inspect-core | storeId atteso se noto |
| diagnostics.get | daemon / inspect-core | nessun dump di ambiente o segreti |
| operation.get | daemon / controller / inspect-core | requestId |
| events.list | daemon / inspect-core | after?, limit <=1000, maxBytes <=64 KiB |
| events.subscribe | daemon | after?; senza cursore parte dal highWater corrente |
| subscription.close | daemon | subscriptionId |
| internal.prepareStop | daemon, solo controller | requestId, targetInstanceId, autorizzazione per stop/restart |
| internal.readiness | daemon, controller | expectedInstanceId, launchGeneration |

Il client pubblico non invia internal.prepareStop: la transizione deve essere sotto control
lease e registrazione di intento del core. Capability del controller per tale operazione
è distinta da quella client, per attempt e target. Nessun client possiede scrittura SQL.

## Request/response e schema semantico

Request: protocolVersion, correlationId, method, params. Mutazioni bootstrap hanno requestId
stabile; correlationId identifica il singolo tentativo. Response: protocolVersion,
correlationId, requestId?, result=OK|BUSY|BLOCKED|ERROR|UNKNOWN_OUTCOME,
outcome?, freshness, liveness, data?, error?.

Error: code, category, message, retryable, operationId?, nextAction, persisted.
Codici definiti: INVALID_REQUEST, UNSUPPORTED_VERSION, UNSUPPORTED_PLATFORM,
UNAUTHORIZED, STALE_TARGET, IDEMPOTENCY_CONFLICT, BUSY, BLOCKED,
PERSISTENCE_UNAVAILABLE, STATE_INCOMPATIBLE, STATE_CORRUPT, DEADLINE_EXCEEDED,
RESOURCE_IDENTITY_UNKNOWN, ENDPOINT_COLLISION, CURSOR_EXPIRED, WRONG_STORE,
SLOW_CONSUMER, CORE_EXITED_BEFORE_ACCEPTANCE e INTERNAL_ERROR.
Nessuna categoria viene interpretata come successo.

status.data: storeId, instanceId?, lifecycle?, ready, currentOperation?, lastError?,
pendingFinalization, observedAt, stateRevision. Una risposta viva durante RECOVERING
ha ready=false. In caso di persistenza indisponibile freshness=VOLATILE e persisted=false;
la revisione autorevole resta l'ultima nota.

## Eventi e replay

Event: protocolVersion, storeId, eventId, seq, occurredAt, instanceId?,
operationId?, type, payload redatto. seq è una stringa decimale monotona per archivio.
Tipi: lifecycle.changed, operation.accepted, operation.completed, operation.failed,
operation.blocked, recovery.started, recovery.completed, resource.blocked,
authorization.denied e diagnostics.degraded. Nessun output grezzo di processi o variabili
d'ambiente entra nel payload.

Cursore: storeId + seq dell'ultimo evento ricevuto. Cursor di un altro archivio ⇒ WRONG_STORE.
Cursor oltre highWater ⇒ INVALID_REQUEST; sotto retentionFloor-1 ⇒ CURSOR_EXPIRED.
La risposta gap include firstAvailable, highWater e nextAction=reread-status; il client
sceglie esplicitamente se continuare dai dati disponibili. Nessuna lacuna silenziosa.

Al subscribe si cattura highWater H e si registra l'osservatore nella stessa serializzazione
del writer. Si consegnano seq > cursore fino a H, poi seq > H dal journal. Le notifiche live
svegliano il pump, non costituiscono una seconda storia in memoria. L'ordine è seq;
il timestamp non determina ordinamento o dedup.

Il checkpoint del cursore è responsabilità del client. Riconnessione può ridare un evento
con stessa seq/eventId: non è una nuova operazione. Nessuna promessa exactly-once sul wire.
Durante un restart la connessione può chiudersi; il client riconnette al successore e usa
lo stesso storeId/cursore.

## Backpressure e retention

Prima di ogni write: contare bytes dei buffer applicativi più writableLength, evitando
di contare due volte lo stesso chunk già consegnato al socket. Se l'ulteriore frame
supererebbe 1 MiB, chiudere con SLOW_CONSUMER, se il canale consente ancora l'ultimo frame.
Se non può essere consegnato, la chiusura senza ultimo frame resta recuperabile mediante
il cursore; la diagnostica server registra motivo redatto.
write=false ⇒ attendere drain, mai produrre altri chunk nel frattempo.

Le pagine lette hanno massimo 64 KiB; il file viene chiuso prima di attendere il client.
Se la retention supera il cursore mentre il client è fermo, gap esplicito o disconnessione.
Nessuna sottoscrizione impedisce rotazione o controllo del lifecycle.
Limiti applicati già al primo incremento streaming E2.

## Bootstrap senza risposta

Prima del commit dell'intento il risultato può essere NOT_ACCEPTED/UNKNOWN; lo stesso
requestId permette di scoprire se l'accettazione sia avvenuta. Dopo commit, controller
e daemon continuano senza client. Nessun timeout causa implicitamente stop/retry/spawn.
Un tentativo non accettato per contesa non inventa una riga operazione: include l'ID
dell'operazione che occupa il controllo e invita a interrogarla o riprovare.

## Verifiche di contratto

Validazione frame/major/auth prima degli effetti; concordanza CLI/IPC; record persistito
prima della conferma; replay-live senza omissioni; retention durante replay; duplicati
riconoscibili; buffer a limite; client lento e dieci lettori; errori durante disco pieno.
