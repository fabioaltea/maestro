# Data model — Foundation

**Data**: 2026-11-08. Modello proposto, nessuno schema eseguito.
Riferimenti: [specifica](spec.md), [lifecycle](contracts/lifecycle.md).

## Archivio e layout

Default: `~/Library/Application Support/Maestro/foundation/default`, oppure percorso
assoluto esplicito `--state-dir`. Il core canonicalizza il percorso, verifica proprietario
UID, directory 0700, file 0600 e assenza di link nei file sensibili. Nessuna inizializzazione
per status/diagnostics su archivio assente.

| Artefatto | Responsabilità |
|-----------|----------------|
| state.sqlite e sidecar WAL/SHM | Stato autorevole; nessuna scrittura dai client |
| control-lease.sqlite | Esclusione fra controller, connessione main dedicata |
| daemon-lease.sqlite | Esclusione fra daemon, connessione main dedicata |
| credentials/client.key | Capability locale, 32 byte casuali, mai loggata |
| credentials/resources/ | Segreti per identità di daemon/ausiliari, non inviati nei report |
| events/ | Segmenti ordinati, prefisso floor e metadata di retention |
| logs/ | Log strutturati redatti con budget condiviso |
| runtime descriptor | Endpoint, UID, storeId, instanceId e controller attivo; indizio non prova di vita |

I socket sono in directory breve privata `/tmp/m-<uid>-<hash16>`, verificata contro
il percorso canonico completo e storeId. Stale socket rimosso solo da proprietario del lease
e dopo prova che nessuna istanza precedente è viva; file estranei o ambigui bloccano.

## Entità e invarianti

Gli ID sono UUID casuali. Seq/revision interi SQLite non negativi sono serializzati sul wire
come stringhe decimali; il client non li converte in Number. Timestamp UTC ISO per diagnosi,
clock monotono per deadline. Gli errori salvano codici e dettagli redatti, non output grezzo.

| Entità | Campi principali | Vincoli e relazioni |
|--------|------------------|---------------------|
| Store | storeId, schemaVersion, ownerUid, canonicalPath, createdAt, revision, nextEventSeq | Singleton; versione sconosciuta blocca; identità stabile attraverso restart |
| DaemonInstance | instanceId, storeId, pid, identityGeneration, lifecycle, startedAt, exitObservedAt?, lastError?, cleanShutdownPrepared | Una istanza corrente; lease è autorità di proprietà, record SQL non è prova di vita |
| ControlOperation | operationId/requestId, storeId, action, payloadHash, ownerUid, targetInstanceId?, successorInstanceId?, phase, outcome, acceptedAt, completedAt?, error? | requestId unico per store; stesso ID e payload diverso ⇒ IDEMPOTENCY_CONFLICT |
| ManagedResource | resourceId, kind, policyScope, owningInstanceId, generation, pid?, endpoint?, credentialRef?, observation, releaseState | kind auxiliary/socket/temp; policyScope foundation soltanto; path entro directory propria; mai un controller in questa tabella |
| ControllerAttempt | attemptId, operationId, pid, identityGeneration, startedAt, endedAt?, result | Più tentativi possono riconciliare la stessa operazione; solo uno con control lease |
| LaunchTicket | ticketId, operationId, successorInstanceId, generation, status, claimedPid?, claimedAt? | Stato ISSUED/CLAIMED/CANCELLED; claim atomico una sola volta, verificato sotto daemon lease |
| EventOutbox | batchId, firstSeq, lastSeq, encodedRecords, encodedBytes | Al massimo una riga; batch massimo 64 KiB, record massimo 16 KiB |
| JournalMetadata | storeId, retentionFloor, durableHighWater, activeSegment, sealedSegments | Aggiornamenti serializzati; ricostruibile dai segmenti validi senza inventare seq |
| Subscription | subscriptionId, storeId, cursor, replayHighWater, pendingBytes, compatibility | Solo memoria client/server; non determina lifecycle e non trattiene lo storico |

Lo storico ControlOperation è autorevole e non viene potato per rispettare la quota dei log.
Gli indici sono su requestId, istanza corrente, operazioni non terminali e risorse non rilasciate.
Niente entità Project/Feature/AI Session, nessun modello provider.

## Lifecycle

Stati persistibili: STARTING, RECOVERING, RUNNING, STOPPING, STOPPED, BLOCKED.
Corrispondono agli stati della specifica. STOPPED è registrato dal controller dopo prova
di cessazione, non dal daemon prima di terminare. Il daemon registra solamente shutdown
preparato; l'assenza del controller non trasforma quella preparazione in successo.

Liveness separata: LIVE_VERIFIED, ABSENT_VERIFIED, UNKNOWN. Freshness:
LIVE, LAST_KNOWN, VOLATILE. Un dato storico RUNNING con liveness UNKNOWN non significa
servizio operativo. La prima osservazione di un archivio vuoto restituisce ABSENT, senza
creare una riga STOPPED.

Transizioni del lifecycle: quelle della specifica, con crash fuori dalla state machine
persistita e riconciliazione prima del ritorno a RUNNING. Perdita della persistenza può
produrre osservazione VOLATILE/BLOCKED senza fingere che la transizione sia stata salvata.

## Operazioni e commit

Outcome: IN_PROGRESS, SUCCEEDED, INTERRUPTED, FAILED, BLOCKED.
UNKNOWN_OUTCOME è una vista del client, non un esito durevole inventato.
Fasi operative:

- start: ACCEPTED → PRECHECK → SPAWN_INTENT → WAIT_READY → FINALIZED.
- stop: ACCEPTED → STOP_REQUESTED → DRAINING → WAIT_EXIT → FINALIZED.
- restart: ACCEPTED → STOP_REQUESTED → WAIT_EXIT → SPAWN_INTENT → WAIT_READY → FINALIZED.

Persistire la fase prima dell'effetto; registrare prove osservate ed esito dopo.
Le fasi possono ripetersi solo dopo verifica dell'effetto precedente.
Ogni spawn usa un LaunchTicket durevole. Prima di qualsiasi effetto applicativo, il nuovo
daemon prende il proprio lease e reclama atomicamente il ticket ancora ISSUED, con generation
e istanza attese. Un ticket annullato, consumato da un altro processo o riferito a un'operazione
non più valida fa terminare il candidato senza aprire il servizio. Un controller che trova
un ticket ISSUED ma nessun proprietario può annullarlo atomicamente e riemettere una nuova
generation: il candidato precedente, anche se avviato in ritardo, non può diventare operativo.
Un ticket CLAIMED richiede invece prova della cessazione del reclamante prima di riemettere.
Questa regola copre il crash fra spawn e registrazione del PID, senza timer di scadenza.
Restart usa un solo requestId e successore preassegnato: non viene tradotto in due comandi
pubblici indipendenti. Per un retry con stesso ID e risultato già terminale si restituisce
l'esito storico, anche se il daemon è successivamente cambiato; una nuova intenzione richiede
un nuovo requestId.

L'accettazione viene confermata solo dopo commit. Il dispatcher controlla UID/capability,
versione, schema, target e lease prima della mutazione. La presenza di un'operazione
incompleta diversa blocca nuove mutazioni fino alla riconciliazione, ma non le letture.
Le operazioni BLOCKED non diventano autorizzazioni eterne: un retry con lo stesso ID può
proseguire solo dopo nuova verifica di target, identità e precondizioni; il vecchio record
resta nello storico. Gli esiti SUCCEEDED/FAILED/INTERRUPTED sono restituiti come risultati
storici senza rieseguire. Nessuna nuova richiesta incompatibile supera il blocco per errore.

Database worker: foreign_keys ON, WAL, synchronous FULL, busy_timeout 50 ms; retry
asincroni limitati dalla deadline e mai loop sincrono sul main. Query read-only paginata
e materializzata prima di rilasciare la transazione. Nessun client di streaming detiene
un reader SQL.

## Transazione stato → evento

1. Acquisire transazione di scrittura breve sullo stato; se esiste outbox, drenarla prima
   di iniziare la nuova mutazione.
2. Validare revisione/precondizioni, aggiornare stato, allocare seq e inserire batch outbox.
3. Commit: solo ora l'esito autorevole è durevole.
4. Sotto serializzazione dello storage, append dei record mancanti al journal, sync,
   aggiornamento highWater e cancellazione outbox. La pubblicazione avviene dopo sync.
5. Lo svuotamento usa una transazione SQLite di scrittura per escludere altri drainer,
   con I/O bounded del solo batch già committato; nessun effetto esterno non registrato.

Crash fra 3 e 4: outbox presente. Crash fra append e clear: riconoscere seq/eventId/checksum
già presenti, non duplicare logical event. La parte finale incompleta è troncata soltanto
se dimostrabile; checksum discordante in record completo blocca preservando i file.
L'evento non è usato come fonte autorevole dello stato: retention non distrugge il recovery.
Se stato è confermato ma journal non è disponibile, risposta distingue esito dell'operazione
e osservabilità degradata; nuove mutazioni con eventi restano bloccate fino al drenaggio.

## Budget diagnostico e retention

Budget di regime massimo 50 MiB: 40 MiB segmenti eventi, 5 MiB log, 4 MiB riservati a
metadata/outbox/overhead condiviso, 1 MiB margine. Incremento temporaneo di rotazione massimo
5 MiB. Nessun aggiramento contando outbox o copie del journal come «stato esente».

- Segmento massimo 1 MiB, inclusi header, framing e checksum. Non serve copia dell'intera
  storia: si sigilla e si elimina il più vecchio prima dell'allocazione del nuovo.
- Record massimo 16 KiB. Payload diagnostici troppo lunghi sono redatti/troncati con
  flag e contatore; ID, seq, categoria ed esito non vengono troncati.
- Outbox: singola riga riutilizzabile, payload 64 KiB; la porzione fisica riservata a
  tabella/indici deve essere verificata entro 1 MiB nel test di saturazione.
- Tutto il WAL condiviso viene contato conservativamente nel budget diagnostico:
  checkpoint TRUNCATE prima di nuovi batch quando raggiunge 1 MiB. Batch SQL limitati
  a una singola transizione/risorsa, senza bulk update; il test di saturazione deve
  dimostrare massimo 1 MiB aggiuntivo per transazione. Se il checkpoint è impedito, si
  sospendono nuove scritture, si chiudono i reader core scaduti e si segnala BLOCKED.
  Limite di esercizio WAL 2 MiB; nessuna affidabilità demandata a journal_size_limit.
- Il restante 1 MiB della riserva copre metadata e sidecar diagnostici. La dimensione
  fisica effettiva, inclusi file aperti non più linkati, è verificata dall'harness.
- Nessuna migrazione o transazione bulk mentre il servizio è operativo; bootstrap separato,
  prima dell'accettazione di comandi. Se un budget non può essere rispettato si blocca,
  non si cambia la soglia. Il gate E1 verifica queste assunzioni di allocazione.
- Un lettore materializza al massimo 64 KiB e chiude il file prima di consegnare al socket:
  un client lento non può mantenere allocati segmenti eliminati.
- Non eliminare segmenti necessari a risolvere l'outbox pendente. retentionFloor persiste
  prima di cancellare segmenti; dopo crash può segnalare una lacuna conservativa.
- Credenziali escluse da ogni diagnostica; per richieste negate si registrano soltanto
  codice, correlationId e contatore, con aggregazione bounded contro flooding.

L'archivio di stato e la storia delle operazioni non sono sottoposti al limite dei log.
La quota diagnostica conta tuttavia l'intero WAL, scelta conservativa esplicita.

## Recovery e controlli di integrità

Al primo accesso scrivente: verifica schema/integrità, revisione, operazioni incomplete,
risorse, ultimo batch e coda journal. Nessuna ricreazione automatica di un file esistente.
Migration path dal vecchio Maestro escluso; evoluzioni future dello schema hanno versioni
esplicite e procedure dedicate.

Una risorsa con nonce/istanza verificati può ricevere shutdown cooperativo.
Assenza accertata del PID o exit osservato prova la cessazione; presenza del PID da sola
non prova appartenenza. UNKNOWN resta bloccante. Il controller stesso è coordinatore
esterno alla policy degli ausiliari Foundation.

Corruzione, accesso negato, disco pieno o errore di sync: preservare stato e file, bloccare
gli effetti che non possono essere registrati, esporre un errore redatto anche non persistito.
