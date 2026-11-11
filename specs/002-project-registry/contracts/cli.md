# Contract — Maestro project CLI v1

Add/list/show/verify/update/operation implementati; remove resta pianificato.
Entry point nello stesso build Foundation: `node dist/cli/main.js`; alias installato `maestro`.

## Sintassi

| Comando | Comportamento |
|---|---|
| maestro project add PATH [--name NAME] [--base-branch BRANCH] | Registra checkout esistente; restituisce CREATED o EXISTING |
| maestro project list [--limit N] [--cursor CURSOR] | Pagina registro confermato; nessuna verifica Git |
| maestro project show PROJECT_ID | Configurazione e ultima osservazione datata |
| maestro project verify PROJECT_ID | Nuova osservazione esplicita, senza cambiare configurazione |
| maestro project update PROJECT_ID --expected-revision REV [--name NAME] [--base-branch BRANCH oppure --clear-base-branch] | CAS della sola configurazione; patch atomica |
| maestro project remove PROJECT_ID --expected-revision REV | Rimuove solo registrazione identificata, anche dirty/indisponibile |
| maestro project operation REQUEST_ID | Consulta esito originale, anche offline |

Opzioni comuni `--state-dir ABSOLUTE_PATH`, `--json`. Mutazioni:
`--request-id UUID` opzionale (generato se omesso), `--timeout-ms` può ridurre,
mai aumentare 30.000 ms. Letture massimo 2.000 ms. La CLI attende l'esito terminale
tramite polling bounded; timeout/disconnessione non annullano il lavoro accettato.
Non riusare automaticamente un nuovo ID dopo un timeout. Per un retry dalla CLI
conservare path assoluto e gli stessi campi, inclusa revisione: alias equivalenti
possono deduplicare il progetto ma non sono necessariamente lo stesso intento.

Name e base omessi all'add sono omissioni nell'hash; il core calcola i default una
sola volta durante l'operazione. Nome default dalla root checkout, se valido; altrimenti
INVALID_NAME. Base default soltanto branch HEAD locale valido, altrimenti null.
Input esplicitamente non valido rifiutato anche se il progetto è già registrato.
Un import duplicato valido non cambia nome/base/reference e restituisce l'esistente.

Update richiede almeno un campo; --clear-base-branch e --base-branch si escludono.
Rinomina/remove possono riuscire senza Git disponibile. Set-base richiede prova
coerente della ref locale a commit, nessun checkout. Tutte le mutazioni richiedono
daemon operativo; nessun comando project lo avvia automaticamente.

## Output, esiti e codici

Stesso PublicResult v1 Foundation. JSON una risposta completa su stdout, senza
progress testuale; nei campi data action/requestId/projectId/revisioni/effect e
accepted esplicito. RequestId sempre disponibile quando generato, anche con timeout.
Modalità umana mostra ID, revisione, osservazione datata e nextAction; non usa il
nome per selezionare un progetto. Non presentare un progetto come pronto/approvato.

| Exit | Significato |
|---|---|
| 0 | Lettura riuscita o mutazione SUCCEEDED, incluso EXISTING; verify può salvare indisponibilità con errore nell'osservazione |
| 2 | Input non valido, ID/revisione in conflitto, elenco da rileggere |
| 3 | BUSY/IN_PROGRESS, accettazione e ID indicati separatamente |
| 4 | BLOCKED o INTERRUPTED con intervento richiesto; identità/config non sicure |
| 5 | Deadline, UNKNOWN_OUTCOME o daemon assente/irraggiungibile |
| 6 | Accesso negato/autorizzazione mancante |
| 7 | Persistenza/integrità o guasto runtime non classificato altrimenti |

Mappatura deterministica: INVALID_* e *_CONFLICT →2; UNKNOWN/CHANGED/UNSUPPORTED
repo, INSPECTION_UN*, OUTPUT_LIMIT, progetto assente/rimosso e registry non inizializzato
→4; DEADLINE/DAEMON_UNAVAILABLE→5; *_ACCESS_DENIED/UNAUTHORIZED→6;
STATE_CORRUPT/INCOMPATIBLE e PERSISTENCE_UNAVAILABLE→7. EVENT_BACKPRESSURE→4.
State assente in list/show è esito esplicito STATE_ABSENT con exit 4.
Il payload distingue sempre cause che condividono exit code.

Un verify SUCCEEDED/OBSERVED con checkout UNAVAILABLE non è una verifica positiva:
CLI mostra il problema e l'ultima data; successo significa osservazione persistita.
Per automazioni, controllare availability/base_state/error oltre all'exit code.

## Offline e retry

List/show/operation: core inspect readonly quando daemon non raggiungibile,
freshness LAST_KNOWN e liveness separata. Nessuna directory/DB/socket creato,
nessun Git, recovery, upgrade o drain. Registro assente non simulato come vuoto.

Stesso requestId+intento ripete l'esito originale, prima dei controlli sullo stato
corrente. ID uguale con intento diverso è IDEMPOTENCY_CONFLICT, zero effetti.
Dopo remove/reimport, il retry della vecchia rimozione ritorna il vecchio UUID.
INTERRUPTED richiede rilettura e una nuova azione volontaria con nuovo ID.
L'autenticazione è controllata anche sui retry e sulle query storiche.

## Prove di contratto

Sintassi/codec/limiti, revisione obbligatoria, discriminazione omissioni, nomi Unicode,
path con spazi/argomenti ostili, output umano/JSON, exit code e errori concordanti,
capability assente, retry, deadline senza cancellazione, letture offline senza scritture,
zero autostart e stesso comportamento per CLI e altro client autenticato.
