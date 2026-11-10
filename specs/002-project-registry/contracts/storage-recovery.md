# Contract — Storage, idempotenza e recovery registry

## Upgrade della nuova Foundation

Schema target 3; stessa SQLite e stessi lease, nessuna migrazione dal vecchio Maestro.
L'upgrade avviene soltanto nel percorso di `daemon start` esplicito autenticato.
Prima di aprire un writer schema 3: detenere control lease e daemon lease, verificare
ownership UID/path e assenza di writer vivo. Se la prova è incerta: BLOCKED senza
modifiche. Non rilasciare la daemon lease fra la verifica e il commit upgrade.

Con connessione di upgrade dedicata, controllare user_version e versione store,
integrità e foreign key; ammettere solo schema 2 noto o 3 già valido. Ricostruire
transazionalmente il piccolo store per il CHECK della versione seguendo la procedura
SQLite, creare tabelle/indici registry e catalogo requestId, copiare i requestId
lifecycle con hash originali, impostare entrambe le versioni 3. Verificare integrità
prima del commit; foreign_keys resta ON durante tutta la procedura qualificata. Mai
writable_schema o modifica diretta del journal. StoreId, righe Foundation, next_event_seq,
outbox, high-water e retention floor devono restare identici. La baseline osservata
ha solo store→instances, senza ciclo o riferimenti inversi a store: ricostruire
il solo store conservando le FK attive. Rifiutare dipendenze sconosciute, senza
rename improvvisato di una parent table referenziata.

Crash precommit lascia schema 2 valido; postcommit lascia schema 3 valido. Spazio
insufficiente/IO/BUSY oltre budget non produce successo. Nessun backup tramite copia
del solo .sqlite mentre esiste WAL. Non è previsto downgrade automatico: vecchi
binari rifiutano lo schema 3 e non lo riparano. Nuovo archivio usa direttamente 3.
Dopo commit rilasciare lease nel normale passaggio controller→daemon e svolgere recovery.

Elenco/dettaglio/operation offline non creano directory, DB o sidecar, non migrano,
non drenano e non cancellano socket. Su schema 2 l'assenza di registry è
REGISTRY_NOT_INITIALIZED; su versione sconosciuta STATE_INCOMPATIBLE. Non inventare
un elenco vuoto o uno storeId. Se assente: STATE_ABSENT. Apertura readonly segue
la Foundation: processo transitorio confinato anche per il driver nativo, nessun
accesso writer allo stato. URI interni RO; eventuale immutable solo con prova
quiescente sotto entrambi i lease esistenti, tenuti per la singola osservazione.
Assenza o race dei sidecar non autorizza creazione/riparazione né un immutable
senza prova. Writer e cataloghi restano nello stesso worker e store Foundation.

## Admission e intento

1. Verificare autenticazione role=client, daemon RUNNING e admission aperta.
2. Validare schema, limiti e intento normalizzato. L'intento contiene path assoluto
   normalizzato lessicalmente (non realpath), nome/base come forniti o omissione,
   projectId/revisione per le azioni che li richiedono, storeId e versione del contratto.
   Non derivare il payload hash dal Git corrente, da default dinamici o dall'esito.
3. Consultare catalogo: ID uguale + hash uguale restituisce pending/risultato originale,
   anche se path o revisione non esistono più; intento diverso è IDEMPOTENCY_CONFLICT.
4. Controllare capienza coda e spazio/outbox. Accettare in transazione IMMEDIATE:
   catalogo + project_operation + operation.accepted. Ack solo dopo commit.

Una richiesta respinta prima dell'accettazione non promette esito durevole; dichiarare
accepted=false. Per richieste ammesse accepted=true e ID durevole. Client timeout
senza ack significa UNKNOWN_OUTCOME; prima di qualunque nuovo intento interrogare
lo stesso ID. Nessun wrapper client sostituisce di nascosto l'ID.

## Esecuzione e commit

Eseguire probe fuori transazione. Per import validare anche la base esplicita prima
della dedup; poi la UNIQUE constraint sul repository comune decide il vincitore.
Il perdente ritorna EXISTING e non pubblica la propria osservazione sul riferimento
vincente. Configurazione/reference checkout esistenti restano invariati.

Prima del commit ricontrollare prova di identità, stato attivo e revisioni catturate.
Nella stessa mutate() esistente scrivere effetto progetto/osservazione, outcome
terminale e batch outbox con operationId esplicito. Incrementare registry_revision
solo per cambi visibili. In caso di rollback niente effetto/evento confermato.
Il nuovo codice storage non usa un secondo recordEvents() dopo il commit.

Il drain journal è postcommit: se fallisce, l'effetto già salvato rimane confermato,
l'outbox conserva l'evento e la risposta dichiara observabilityDegraded. Un retry
restituisce il risultato salvato, senza nuova mutazione; la salute corrente è un
campo separato dall'esito originale. Le successive scritture rispettano backpressure
Foundation; nessuna scappatoia per errori o verify.

Aggiungere letture registry a entrambe le allowlist worker: dispatch readonly e
letture consentite durante failure. Continuano letture indipendenti mentre il writer
fa BUSY backoff; nessuna transazione attraversa await o attesa Git.

## Crash e stop

| Punto di crash | Stato atteso al recupero |
|---|---|
| Prima del commit admission | Nessuna accettazione; query NOT_FOUND, nessun progetto |
| Dopo admission, prima/durante probe | Intento presente, nessun effetto parziale; recovery INTERRUPTED |
| Durante commit finale | O tutto assente o effetto/esito/outbox interamente confermati |
| Dopo commit, prima ack | Query/retry stesso ID restituiscono l'esito originale |
| Durante drain/notifica | Evento nell'outbox o journal, stessi ID/seq, niente doppio effetto |

In RECOVERING, prima di RUNNING, riconciliare ausiliari probe tramite identità/nonce,
non PID. Terminalizzare i pending della vecchia istanza come INTERRUPTED con evento
persistente e nextAction=read-project-then-new-request. Non rieseguire i probe.
Se risorse/archivio restano incerti mantenere BLOCKED; niente operatività finta.

Su stop, admission fence prima di STOPPING; fermare l'avvio di nuovi probe, cancellare
quelli posseduti entro budget, finalizzare pendenti come INTERRUPTED e drenare secondo
Foundation prima di chiudere lo store. Si usa il budget stop già esistente (10 s,
drain ausiliari entro 8 s), senza aggiungervi altri 30 s. Se IO impedisce finalizzazione,
nessun falso esito: recovery successiva riconcilia l'intento persistito.

Questi supervisor sono ausiliari Foundation. Nessuna modifica alla futura policy di
processi agente, nessuna uccisione di shell utente o processi Git estranei.

## Verifiche necessarie

Upgrade con crash pre/post commit, FK/storeId/seq invariati; ACK perso; SQLite FULL/IO;
catalogo collisione lifecycle/registry; 20 import simultanei; 100 retry; remove e
reimport seguito da vecchio retry; verify obsoleto; disconnect; stop e crash con Git
bloccato; outbox piena e drain guasto; eventi dopo commit e replay dopo restart.
