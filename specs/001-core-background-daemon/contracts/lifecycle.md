# Lifecycle contract

**Versione**: 1. **Ambito**: core Foundation, macOS iniziale.

## Bootstrap e ruoli

`LocalClient` è usato dalla CLI e riutilizzabile da futuri client. Per mutazioni invoca
`ControlExecutor`, entry point del core installato, con un messaggio bootstrap JSON
massimo 64 KiB su pipe d'ingresso. Nessuna shell, comandi arbitrari o segreti in argv.
Il messaggio completo deve essere acquisito prima dell'accettazione; EOF prematuro rifiuta
la richiesta. Dopo l'acquisizione, la pipe viene chiusa: non determina la vita del controller.
I risultati sono interrogabili via socket/inspect-core e requestId, non stdout del controller.

Launcher macOS: spawn detached, stdio ignorati salvo questa pipe iniziale bounded,
unref; daemon con tutti gli stdio ignorati. Nessun fd del terminale ereditato.
La perdita del client prima dell'accettazione non garantisce esecuzione; dopo commit
dell'intento non annulla l'operazione.

Il controller prende control-lease.sqlite, verifica UID/percorso/credenziali, prepara il
proprio endpoint privato e accetta l'intenzione. Candidate concorrente: nessun effetto,
ritorna operazione in corso oppure esito storico tramite lettura core. Non attende il
lock indefinitamente e non assume che l'età del file consenta di eliminarlo.
Un errore di spawn, caricamento del driver o preflight prima dell'accettazione produce
NOT_ACCEPTED con categoria e azione suggerita tramite il canale di osservazione del launcher
o un report bootstrap core bounded. Se il processo termina prima di produrre tale report,
si espone CORE_EXITED_BEFORE_ACCEPTANCE con exit code noto e disponibilità diagnostica
limitata; non si attribuisce una causa non osservata. Nessun risultato è dichiarato persistito
finché l'archivio non lo conferma.

## Start

1. Validare schema del comando, versione e autorizzazione locale.
2. Se il requestId esiste, confrontare payloadHash e restituire/riconciliare la stessa operazione.
3. Se un altro controllo è incompleto, riconciliarlo in sicurezza o restituire BUSY/BLOCKED.
4. Con daemon già autenticato RUNNING: registrare NOOP_ALREADY_RUNNING.
5. Altrimenti, verificare libero il daemon lease e cessata la precedente identità.
   Endpoint irraggiungibile con processo presente ⇒ BLOCKED, non spawn.
6. Registrare SPAWN_INTENT con successorInstanceId, credenziale e LaunchTicket ISSUED
   prima di spawn. Il ticket ha generation e stato persistenti.
7. Avviare daemon detached; il daemon acquisisce il lease autonomamente. Il controller
   non gli «passa» un possesso mediante un PID file.
8. Sotto daemon lease, il candidato reclama atomicamente il ticket ancora valido con
   la propria identità. Ticket vecchio, annullato o già consumato ⇒ uscita senza effetti.
   Daemon valida dati e risorse, riconcilia eventuali operazioni, apre il socket di
   controllo inizialmente non-ready e passa a RUNNING solo al termine.
9. Handshake di readiness su storeId/instanceId/versione; controller registra SUCCEEDED.
   Un semplice evento spawn non prova readiness.
10. Controller termina. Il daemon mantiene il proprio lease e continua.

Se controller muore fra spawn e salvataggio, l'istanza preassegnata e il lease consentono
al prossimo controllo di verificare se l'effetto è già avvenuto. Non viene creato un secondo
daemon perché manca una risposta.
Un ticket non ancora reclamato può essere annullato atomicamente sotto control lease
prima di un nuovo tentativo; il vecchio candidato ritardato sarà rifiutato dal claim.
Un ticket reclamato non può essere sostituito senza prova di cessazione del reclamante.
Il percorso stop annulla gli eventuali ticket ISSUED prima di confermare l'assenza:
nessun daemon può comparire in ritardo dopo uno stop già dichiarato riuscito.

## Stop

1. Controller registra STOP_REQUESTED per un targetInstanceId immutabile.
2. Se assenza e nessuna risorsa Foundation residua sono già verificate: NOOP_ALREADY_STOPPED.
3. Connettersi all'identità del daemon, autorizzare `internal.prepareStop`.
4. Daemon entra STOPPING, rifiuta nuove mutazioni, drena/segna interruzioni, gestisce
   ausiliari Foundation cooperativi, salva shutdownPrepared e chiude worker/servizi.
5. Se un ausiliario non coopera o resta incerto, daemon resta BLOCKED e non conferma stop.
6. Daemon termina mantenendo il lease fino alla fine della vita del processo.
7. Controller verifica exit/assenza della precedente istanza, lease libero e risorse
   rilasciate; soltanto allora persiste STOPPED e SUCCEEDED.

Se il controller scompare, il daemon completa la richiesta accettata. La finalizzazione
mancante è riconciliata al successivo comando esplicito; lo stato read-only segnala
`pendingFinalization`, senza scrivere. La CLI può restituire UNKNOWN_OUTCOME, non successo.

Una sonda del PID che restituisce ESRCH prova assenza in quel momento; EPERM o PID presente
senza handshake danno UNKNOWN. Nessun segnale distruttivo è inviato in questo percorso.
Gli eventi exit di figli realmente osservati sono prove valide anche se il PID viene riusato.

## Restart

Un'unica operazione governa stop verificato e start del successore. Il controller conserva
il control lease lungo entrambe le fasi. Non esistono due proprietari attivi; la finestra
senza daemon è intenzionale e diagnosticabile. Restart da STOPPED usa il percorso start.
Il controller, indipendente dalla CLI, completa il restart già accettato anche senza client.

Crash del controller: niente retry automatico o supervisore. Alla successiva richiesta
esplicita si osservano target, successore preassegnato, lease e fase; si finalizza ciò che
è già avvenuto, si prosegue solo se sicuro, altrimenti BLOCKED. Un nuovo requestId non
aggira un'operazione incompatibile ancora incerta.
La prosecuzione di effetti ancora da compiere richiede il retry dello stesso requestId
e della stessa azione. Un comando differente può osservare e finalizzare effetti già
verificati, ma non riprende implicitamente un vecchio restart. Uno stop esplicito può
annullare ticket ISSUED non reclamati di un precedente start/restart senza controller vivo,
marcando l'operazione precedente INTERRUPTED; un ticket CLAIMED richiede invece il percorso
di arresto dell'identità verificata. Se la proprietà è incerta resta BLOCKED.

Daemon e controller hanno autorità distinte: il daemon aggiorna la propria istanza e
le risorse Foundation; il controller aggiorna le fasi/esiti del controllo. Durante il
bootstrap il daemon riconcilia risorse e comunica prove, senza ripetere o finalizzare
autonomamente l'operazione attualmente posseduta dal controller.

SIGTERM/SIGINT ricevuti direttamente dal daemon sono richieste esplicite di arresto
controllato: vengono inoltrate al percorso del controller con un requestId nuovo, senza
salti della persistenza o force sui figli. Se un controller è già attivo, il segnale
converge sullo stop in corso oppure produce BUSY/BLOCKED, senza aggirare il lease.
SIGHUP non causa arresto; SIGKILL e crash restano i casi di recovery al successivo avvio.

## Recovery di risorse Foundation

Solo kind=auxiliary, policyScope=foundation. Credenziale e generation vengono registrate
prima dello spawn. L'ausiliario espone un canale privato e non muore perché la sua pipe
padre si chiude. Sul canale autenticato riceve shutdown; il core attende prova di cessazione.
Gli endpoint irraggiungibili non autorizzano kill per PID né killpg. Al timeout BLOCKED.

Il controller non è un ausiliario del daemon. Nessun contratto impone questa policy ai
futuri processi Agent Runtime; i meccanismi comuni non contengono «terminate all children».
Nessun comando pubblico permette di lanciare un ausiliario arbitrario: i test usano fixture.

## Deadline, errori e permessi

Stato: deadline 2 s. Stop: dopo 10 s non conclusi risposta BLOCKED; nessun force.
Start/restart: attesa massima 30 s, target ordinari 5/15 s. Recovery: entro 30 s RUNNING
o diagnosi BLOCKED. Il controller registra il timeout quando possibile e non avvia
ulteriori effetti alla cieca. Il client scaduto non annulla l'operazione già accettata.

Non si forza un processo per rispettare un target. Se un processo figlio appena avviato
si inizializza tardi, la riconciliazione ne osserva l'identità preassegnata; nessun retry
spawna un sostituto finché il suo esito resta sconosciuto.

Autorizzazione del comando vale per azione, store e target corrente. Un vecchio stop per
istanza A non arresta una nuova istanza B; restituisce il risultato storico o STALE_TARGET.
