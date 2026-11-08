# Research — Core Foundation & Background Daemon

**Data**: 2026-11-08
**Stato**: decisioni di progetto completate; nessuna implementazione o benchmark eseguito.
**Input**: [specifica](spec.md), [Constitution](../../.specify/memory/constitution.md).

Le fonti documentano le primitive disponibili. Le combinazioni descritte sotto sono
decisioni progettuali di Maestro, da verificare con i test indicati, non garanzie offerte
automaticamente dalle librerie. La ricerca parallela ha coperto lifecycle/OS e storage/eventi.

## R1 — Runtime, linguaggio e dipendenze

**Decisione**: baseline Node.js 26.13.0 LTS, TypeScript 6.0.3, ESM compilato con
`tsc`, configurazione strict/NodeNext. Un unico package npm; lockfile nuovo.
Runtime: `better-sqlite3@13.0.3`; niente framework server o ORM. CLI tramite
`node:util.parseArgs`, IPC tramite `node:net`, test tramite `node:test` e `node:assert`.
Tipi Node 26 e tipi del driver saranno bloccati nel lockfile durante il bootstrap.

**Motivo**: stack limitato, API del database sostituibile, runtime e compiler verificati
su fonti primarie. La baseline è una scelta riproducibile, non un obbligo di restare su
patch obsolete: aggiornamenti di sicurezza richiedono riesecuzione dei test pertinenti.
La disponibilità del binario nativo del driver per Node/architettura è un gate del bootstrap;
in assenza di prebuild, compilazione con toolchain Apple documentata, senza cambiare driver
silenziosamente.

**Alternative**: Node 24 maintenance LTS; `node:sqlite`, ancora Release Candidate nelle
pagine consultate; database remoto; ORM e framework HTTP. Il driver scelto aggiunge una
dipendenza nativa ma evita di assumere stabile un'API RC.

Fonti: [release Node](https://github.com/nodejs/Release),
[release TypeScript](https://github.com/microsoft/TypeScript/releases),
[better-sqlite3 13.0.3](https://github.com/WiseLibs/better-sqlite3/releases/tag/v13.0.3),
[node:sqlite](https://nodejs.org/api/sqlite.html),
[test runner](https://nodejs.org/api/test.html).

## R2 — Prima piattaforma e confini OS

**Decisione**: macOS 26.3, arm64, filesystem locale APFS; riferimento osservato nel workspace
26.3.1. Non è promessa compatibilità Linux, Windows o Intel nella prima milestone.
Interfacce dedicate per launcher, lease, trasporto, identità dei processi e percorsi/permessi.
Nessuna dipendenza OS nelle transizioni del dominio.

**Motivo**: consente una prima validazione reale sulla piattaforma dell'utente e conserva
confini testabili. Le altre piattaforme devono fallire con errore esplicito prima di una
mutazione; nessun fallback ad assunzioni POSIX generiche.

**Alternative**: Linux con pidfd offre possibilità diverse; supportarlo subito aumenterebbe
lo scope. Un addon macOS per libproc può migliorare l'ispezione futura, ma non è necessario
al percorso conservativo scelto in R5.

Fonti: contesto locale `sw_vers`; [Node IPC](https://nodejs.org/api/net.html#ipc-support),
[libproc Apple](https://github.com/apple-oss-distributions/xnu/blob/main/libsyscall/wrappers/libproc/libproc.h).

## R3 — Daemon e controller transitorio del core

**Decisione**: la CLI avvia un controller headless detached per ogni richiesta mutante.
Il controller acquisisce il lease di controllo, registra la richiesta, governa start/stop/restart
e termina. Il daemon è un altro processo detached, persistente a riposo. Entrambi usano
stdio scollegati dal terminale, nessuna dipendenza da un canale padre e `unref()`.
La disconnessione della CLI dopo accettazione non interrompe l'operazione.

**Motivo**: un daemon non può registrare un esito successivo alla propria morte. Il controller
può verificare la cessazione reale e registrare lo stop, poi avviare il successore per restart.
È un esecutore temporaneo del core, non un supervisore di restart automatico, né un ausiliario
posseduto dal daemon. La CLI non apre il database in scrittura.

**Alternative**: restart gestito dalla CLI perderebbe continuità alla sua chiusura;
supervisore permanente aggiungerebbe overhead; autospawn del successore dal daemon lascerebbe
più finestre di stato incerto. Un controller in crash lascia un'operazione riconciliabile al
successivo comando esplicito; non viene riavviato in loop.

La documentazione Node richiede anche il distacco degli stdio per l'indipendenza dal terminale:
[detached processes](https://nodejs.org/api/child_process.html#optionsdetached).

## R4 — Esclusione e identità dell'archivio

**Decisione**: due file SQLite dedicati, `control-lease.sqlite` e `daemon-lease.sqlite`,
ognuno con una singola connessione del proprietario e una transazione `BEGIN IMMEDIATE`
mantenuta per la durata del possesso. Il controller prende il primo, il daemon il secondo.
Questi file non contengono lo stato applicativo e non vengono eliminati, rinominati o
sostituiti, neppure quando sembrano vecchi. Il crash del processo libera i lock OS.

**Motivo**: usare un'esclusione del filesystem locale senza lease a scadenza o euristiche
di heartbeat. La connessione del lease resta nel thread principale; il database di stato
è gestito da un worker separato. La perdita di un worker non deve liberare la proprietà
del processo ancora vivo. Nessun altro descrittore dello stesso file lease viene aperto
e chiuso nel processo proprietario.

Un lease libero non dimostra da solo la morte del vecchio processo: il controller deve
anche ottenere la prova di cessazione R5. Percorso canonico dell'archivio, UID e storeId
impediscono alias accidentali; file sensibili con symlink o hardlink non sono accettati.

**Alternative**: lock tramite mkdir con scadenza può sottrarre proprietà a un processo
sospeso; solo PID file non esclude corse; flock nativo aggiungerebbe un altro binding.

Fonti: [transazioni SQLite](https://www.sqlite.org/lang_transaction.html),
[locking](https://www.sqlite.org/lockingv3.html),
[rischi di unlink e descrittori](https://www.sqlite.org/howtocorrupt.html).

## R5 — Process ownership e recupero conservativo

**Decisione**: ogni istanza/ausiliario Foundation ha identità casuale e credenziale privata.
L'identità viva viene verificata con challenge su connessione locale; un PID letto dal
database non autorizza segnali. Gli ausiliari cooperativi ricevono shutdown sul canale
autenticato. Nessun kill per PID recuperato, kill di gruppo o force automatico.

Prova di cessazione: evento exit di un figlio osservato direttamente, oppure assenza
accertata del PID originario. La sonda di esistenza non invia segnali distruttivi.
PID presente senza identità autenticabile, accesso negato o errore di ispezione ⇒ UNKNOWN
e blocco. Un PID riutilizzato può quindi provocare un blocco conservativo, mai la
terminazione del processo estraneo. Nessuna assunzione di esattezza da nome o cmdline.

**Motivo**: verificare PID/start-time e poi inviare kill lascia una race. Qui la Foundation
controlla propri ausiliari cooperativi e può fermarsi senza inventare una garanzia OS.
Il futuro Agent Runtime potrà usare policy differenti sopra gli stessi confini di sicurezza.

**Alternative**: libproc per distinguere positivamente la nascita di un processo migliorerebbe
la disponibilità, ma non rende atomico un successivo kill per PID; rimandato.

Fonte: [semantica Apple kill(2)](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/kill.2.html).

## R6 — Persistenza e operazioni idempotenti

**Decisione**: `state.sqlite`, WAL, foreign_keys ON, synchronous FULL esplicito;
worker storage con transazioni brevi. Solo componenti del core aprono lo stato.
Le letture offline passano da un esecutore core di sola lettura; non attivano il daemon.
La mutazione registra intenzione prima dell'effetto, poi esito e revisione. Request ID
e hash del payload distinguono retry da riutilizzo scorretto dell'identificativo.

**Motivo**: stato confermato, errore di risposta e stato osservato restano distinti.
A startup, versione incompatibile o integrità non verificabile blocca; non si ricrea
l'archivio. Lo storico delle operazioni non viene cancellato per far spazio ai log.
Contesa SQLite ha tentativi limitati e risposte BUSY, non attese indefinite.

**Alternative**: JSON condiviso richiede ricostruire transazioni e concorrenza; database remoto
contraddice la Foundation locale; tenere la transazione dello stato aperta per la vita del
daemon impedirebbe l'esecutore di controllo.

Fonti: [WAL](https://www.sqlite.org/wal.html),
[synchronous](https://www.sqlite.org/pragma.html#pragma_synchronous),
[durabilità del driver](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/performance.md).

## R7 — Eventi durevoli con limite fisico

**Decisione**: outbox transazionale singola e limitata a 64 KiB, seguita da journal a segmenti
di circa 1 MiB, record con seq/eventId/lunghezza/checksum. Stato ed outbox sono committati
insieme; append e sync precedono pubblicazione. Prima della successiva mutazione con eventi
si svuota l'outbox. Crash dopo append e prima di ack: dedup per identità e seq.
Solo una coda finale dimostrabilmente incompleta può essere troncata; altra corruzione blocca.

Budget fisico: journal 40 MiB, log 5 MiB, fino a 4 MiB per outbox, metadata e overhead
diagnostico condiviso; tetto complessivo 50 MiB, con soli 5 MiB temporanei aggiuntivi.
Il writer contabilizza file effettivi, non solo payload. I dettagli del controllo dello
spazio sono in data-model.md. Nessuna copia dell'intero storico durante la rotazione.

**Motivo**: la cancellazione di righe non implica riduzione fisica del file SQLite.
`journal_size_limit` non è un limite rigido al WAL attivo: non basta a soddisfare NFR-004.
Se l'outbox non può drenare, si blocca l'avanzamento invece di accumulare diagnostica infinita.

**Alternative**: tutto in una tabella eventi rende più difficile attribuire e limitare
lo spazio diagnostico; bus esterno e event sourcing completo non necessari.

Fonti: [journal_size_limit](https://www.sqlite.org/pragma.html#pragma_journal_size_limit),
[file sync Node](https://nodejs.org/api/fs.html#filehandlesync).

## R8 — IPC, streaming e backpressure

**Decisione**: socket Unix in directory privata 0700, file 0600, capability locale casuale,
protocollo NDJSON v1 validato, nessun listener TCP. Directory runtime breve sotto
`/tmp/m-<uid>-<hashArchivio>`, con controllo owner e divieto symlink. Il path resta sotto
90 byte; collisioni o artefatti estranei producono blocco, non rimozione.

Streaming con cursore storeId/seq, replay paginato e passaggio al live senza finestre perse.
Un osservatore ha massimo 1 MiB fra buffer applicativi e writable; al limite viene scollegato.
I lettori non trattengono transazioni SQL né segmenti cancellati oltre il batch corrente.
Il client usa la posizione salvata per riallinearsi; nessuna promessa exactly-once sul wire.

**Motivo**: accesso locale e controllabile, stessa semantica per CLI e client futuri.
Directory protetta e capability verificata dal core escludono altri UID; root e processi
maligni dello stesso utente restano fuori dal confine della specifica.
I limiti applicativi sono necessari: highWaterMark non è un hard cap.

Fonti: [socket IPC](https://nodejs.org/api/net.html#ipc-support),
[stream buffering](https://nodejs.org/api/stream.html#buffering).

## R9 — Verifica e consegna incrementale

**Decisione**: test unitari con Clock/OS/Storage sostituibili, contratti CLI/IPC e integrazione
su processi locali. Eventi: prima persistenza/consultazione, poi streaming già limitato,
poi replay/lacune, infine carico e saturazione. Ogni incremento ha una prova indipendente.
I report distinguono target della specifica, misure osservate ed esito. Zero benchmark
eseguiti durante questo comando.

**Alternative**: una sola consegna eventi a fine milestone ritarderebbe la verifica di
durabilità; test solo mocked non dimostrerebbero distacco dal terminale o crash safety.

Fonte per il runner scelto: [Node test runner](https://nodejs.org/api/test.html).
