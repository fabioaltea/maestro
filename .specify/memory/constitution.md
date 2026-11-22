<!--
Sync Impact Report
Versione: template non ratificato → 1.0.0 (prima adozione greenfield).
Principi: sostituiti i cinque segnaposto con otto principi concreti:
I. Local-first; II. Core headless e confini dei client; III. Provider agnostic;
IV. Git safety; V. Stato esplicito e process recovery; VI. Approvazioni esplicite;
VII. Testabilità; VIII. Osservabilità.
Sezioni aggiunte: Ambito e scelte architetturali; Verifica di conformità;
Governance compilata. Sezioni rimosse: nessuna sezione normativa preesistente.
Allineamento:
✅ .specify/templates/plan-template.md — gate verificabili per gli otto principi.
✅ .specify/templates/spec-template.md — scenari e test costituzionali espliciti.
✅ .specify/templates/tasks-template.md — task di verifica e resilienza pertinenti.
✅ .specify/templates/agent-file-template.md — verificato, nessuna modifica richiesta.
✅ docs/product-brief.md — verificato, nessuna modifica richiesta.
Comandi: .specify/templates/commands/*.md assenti; verificata la skill locale
speckit-tasks: i test obbligatori sono richiesti esplicitamente dal spec-template.
README.md e AGENTS.md non presenti nel working tree; nessun ripristino richiesto.
TODO e follow-up manuali: nessuno.
-->

# Maestro Constitution

## Core Principles

### I. Local-first

Repository, stato autorevole e supervisione dei processi DEVONO risiedere sulla macchina
dell'utente. Consultazione dello stato e gestione locale NON DEVONO richiedere un servizio
cloud Maestro. Le sole operazioni che dipendono da provider o remoti possono richiedere rete;
la loro indisponibilità DEVE produrre uno stato esplicito, preservando i dati locali.

### II. Core headless e confini dei client

Il core DEVE funzionare come daemon Node.js/TypeScript senza Electron. Orchestrazione,
persistenza e applicazione delle policy DEVONO appartenere al core. CLI e futura UI Electron
DEVONO usare contratti locali documentati per comandi, stato ed eventi, senza modificare
direttamente la persistenza. Disconnessione o chiusura di un client NON DEVE interrompere
il daemon o le sessioni; l'arresto DEVE essere un'operazione esplicita del core.

### III. Provider agnostic

Modello di dominio e lifecycle NON DEVONO dipendere da formati o SDK di un provider.
Gli adapter DEVONO isolare integrazioni e autenticazione supportate, dichiarare le capacità
effettive e normalizzare eventi ed errori. Capacità assenti o sconosciute NON DEVONO essere
simulate come disponibili. Checkpoint di lavoro DEVONO essere comprensibili al core senza
assumere trasferibilità della memoria conversazionale proprietaria tra provider.

### IV. Git safety

Il lavoro concorrente DEVE usare branch e worktree dedicati. Prima di merge, cleanup o altre
mutazioni Git a rischio, il core DEVE verificare stato corrente, proprietà delle risorse e
precondizioni, coordinando operazioni concorrenti sullo stesso repository. Modifiche locali
NON DEVONO essere sovrascritte o eliminate implicitamente. Conflitti o stato incerto DEVONO
bloccare l'operazione e preservare il lavoro; il cleanup DEVE dimostrare che non perde lavoro
non integrato, salvo scarto esplicitamente autorizzato. Un worktree NON È una sandbox di sicurezza.

### V. Stato esplicito e process recovery

Lifecycle e transizioni DEVONO essere espliciti e persistenti. Le operazioni con effetti
esterni DEVONO registrare intenzione ed esito per consentire la riconciliazione dopo un crash.
Al riavvio, il core DEVE riconciliare stato persistito, processi, filesystem e Git prima di
riprendere il lavoro. Retry e recovery NON DEVONO duplicare run o ripetere effetti alla cieca:
servono idempotenza o verifica dell'esito precedente. Processi orfani e identità dei processi
DEVONO essere verificati prima di riuso o terminazione. Shutdown controllato e recovery DEVONO
preservare uno stato riprendibile oppure dichiarare la necessità di intervento.

### VI. Approvazioni esplicite

Il core DEVE applicare i gate di autorizzazione, indipendentemente da prompt, provider e UI.
Ogni approvazione DEVE identificare azione, ambito e versione degli artefatti o precondizioni
approvati; modifiche rilevanti DEVONO invalidarla. In assenza di autorizzazione valida,
l'operazione DEVE restare bloccata. Implementazione, integrazione locale, pubblicazione remota
e deployment DEVONO avere autorizzazioni distinte. Pubblicazione e azioni distruttive richiedono
approvazione esplicita per default; eventuali policy automatiche DEVONO essere autorizzate
dall'utente, limitate nell'ambito, revocabili e verificabili. Un'approvazione NON DEVE ampliare
implicitamente i permessi di agenti, skill o tool.

### VII. Testabilità

Logica di dominio ed effetti esterni DEVONO essere separati tramite confini sostituibili.
I test del core DEVONO poter usare provider simulati, tempo controllato e risorse temporanee,
senza UI, credenziali reali o servizi esterni. Ogni modifica agli invarianti DEVE includere
test automatici pertinenti: unitari per transizioni e policy, di contratto per adapter e API,
di integrazione con Git e processi reali locali per safety e recovery. I percorsi critici
DEVONO coprire crash, retry, concorrenza e autorizzazioni mancanti, oltre al caso di successo.

### VIII. Osservabilità

Il core DEVE esporre stato interrogabile, eventi e log strutturati con identificativi di
correlazione per progetto, sessione, run e operazione, dove applicabili. Transizioni, errori,
attese, decisioni di autorizzazione e azioni di recovery DEVONO essere ricostruibili senza UI.
Credenziali e segreti NON DEVONO comparire nei log; raccolta e conservazione dell'output
DEVONO avere limiti espliciti per evitare crescita incontrollata delle risorse locali.

## Ambito e scelte architetturali

Questa è una nuova implementazione: NON sussistono obblighi di compatibilità, riuso o
migrazione dal precedente Maestro. Il brief definisce la visione; specifiche e piani
definiscono funzionalità e milestone nel rispetto di questi principi. Database, trasporto
IPC, librerie e strategie di dipendenze restano decisioni motivate nei piani. La futura UI
Electron è un client separato e non appartiene alla prima milestone. Estensioni e ottimizzazioni
DEVONO rispondere a esigenze verificabili, senza costruire anticipatamente infrastrutture future.

## Verifica di conformità

Ogni specifica DEVE dichiarare gli invarianti coinvolti e richiedere esplicitamente i test
pertinenti. Ogni piano DEVE verificare tutti gli otto principi, prima della ricerca e dopo
il design, con evidenze oppure una motivazione di non applicabilità. I task DEVONO includere
le verifiche necessarie nell'incremento interessato. La review DEVE verificare conformità ed
esiti dei test prima dell'integrazione; una violazione irrisolta blocca l'avanzamento.

## Governance

La Constitution prevale su specifiche, piani, task e convenzioni del progetto. Ogni modifica
DEVE documentare motivazione, impatto sui documenti dipendenti e approvazione del responsabile
del progetto. Una deroga richiede un emendamento approvato prima dell'attuazione; annotare
una violazione in un piano non la autorizza. La versione segue SemVer: MAJOR per rimozione
o ridefinizione incompatibile di principi o governance, MINOR per nuovi obblighi compatibili,
PATCH per chiarimenti senza variazioni normative. Ogni emendamento DEVE aggiornare data,
Sync Impact Report e artefatti dipendenti; la data di ratifica iniziale resta invariata.

**Version**: 1.0.0 | **Ratified**: 2026-11-08 | **Last Amended**: 2026-11-08
