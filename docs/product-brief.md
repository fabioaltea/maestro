# MAESTRO — Product Brief & Technical Planning Request

**Project:** Maestro  
**Type:** Local AI Development Orchestrator  
**Phase:** Greenfield Architecture & Implementation Planning  
**Initial Target:** Node.js Background Daemon  
**Future Target:** Electron Desktop Application

## 1. Visione del prodotto

Maestro è un orchestratore locale di agenti AI per lo sviluppo software.

L'obiettivo è consentire all'utente di gestire più progetti e più agenti contemporaneamente, assegnando feature indipendenti a provider AI differenti, senza duplicare inutilmente repository e dipendenze.

Maestro dovrà governare l'intero ciclo di sviluppo:

**Project Discovery → Feature Planning → Agent Execution → Review → Local Merge → Release**

Il sistema dovrà essere:

- Local-first.
- Multi-project e multi-session.
- Multi-provider (Codex, Claude Code, Gemini CLI, OpenCode, ecc.).
- Persistente anche senza interfaccia grafica aperta.
- Efficiente nell'utilizzo di CPU, RAM e spazio disco.
- Estensibile tramite Agent Profiles, Skills e Tools.
- Affidabile nella gestione dello stato, dei processi e delle operazioni Git.

Maestro non deve sostituire gli strumenti di coding AI, ma orchestrare quelli esistenti.

## 2. Repository esistente — Complete Rewrite

Il repository Maestro contiene una precedente implementazione sperimentale, che consideriamo superata.

**La decisione è ripartire completamente da zero.**

Non è richiesta alcuna analisi della vecchia architettura finalizzata al recupero di componenti, al refactoring o alla compatibilità con l'implementazione precedente.

Il nuovo Maestro deve essere progettato come un progetto greenfield, senza vincoli derivanti dalla vecchia codebase.

Linee guida:

1. Non riutilizzare automaticamente moduli, componenti, interfacce o convenzioni del vecchio Maestro.
2. Non progettare migration path, compatibility layer o strategie di refactoring incrementale.
3. Non mantenere dipendenze o scelte architetturali soltanto perché già presenti nel repository.
4. Progettare struttura, moduli, contratti, persistenza e lifecycle da zero.
5. Considerare il repository attuale esclusivamente come destinazione del nuovo progetto.
6. Non modificare o eliminare file durante questa fase di pianificazione.
7. Prevedere nel piano operativo una fase iniziale di pulizia della vecchia implementazione, con verifica preventiva dei file da preservare e delle eventuali modifiche non committate.

La pulizia dovrà essere effettuata solo nella successiva fase di implementazione, previa autorizzazione esplicita.

## 3. Architettura target

L'architettura desiderata prevede due livelli principali.

### A. Maestro Core — Background Daemon

Processo Node.js/TypeScript indipendente dalla UI.

Responsabilità:

- Gestione dei progetti registrati.
- Orchestrazione delle sessioni AI.
- Gestione e monitoraggio dei processi figli.
- Provider adapters.
- Creazione e gestione dei Git Worktrees.
- Preparazione degli ambienti e delle dipendenze.
- Gestione delle specifiche di progetto e feature.
- Gestione delle skill e degli agent profile.
- Persistenza dello stato.
- Scheduling, pause, resume e recovery.
- Review, merge e release.
- Esposizione di API e stream di eventi locali.

Il daemon deve poter funzionare senza Electron e consentire a sessioni già avviate di continuare anche quando la futura UI viene chiusa.

Valutare architetture appropriate per IPC, lifecycle, startup, shutdown, logging, crash recovery e comunicazione con i client.

### B. Maestro Desktop — Fase successiva

Applicazione Electron + React + TypeScript.

Esperienza prevista:

1. Apro Maestro.
2. Visualizzo i progetti registrati.
3. Seleziono oppure importo un repository locale.
4. Eseguo la Project Discovery, se necessaria.
5. Creo una feature.
6. Scelgo un Agent Profile e un provider.
7. Avvio una sessione.
8. Monitoro attività, terminale, modifiche e stato.
9. Revisiono e integro il lavoro.
10. Gestisco la pubblicazione verso origin.

La UI non deve contenere la logica di orchestrazione.

**La progettazione e l'implementazione di Electron non fanno parte della prima milestone.** Il daemon deve però essere progettato per potervi collegare facilmente una dashboard in futuro.

## 4. Project Discovery obbligatoria

Prima della creazione di qualsiasi feature, Maestro deve comprendere il progetto.

Un agente generale, con un profilo dedicato (*Project Architect*), deve:

- Analizzare la codebase esistente.
- Identificare stack, architettura, moduli e dipendenze.
- Comprendere le funzionalità già implementate.
- Individuare convenzioni e flussi applicativi.
- Intervistare l'utente sulle informazioni non ricavabili dal codice.
- Produrre documentazione funzionale e tecnica strutturata.
- Richiedere l'approvazione dell'utente.

La documentazione deve distinguere informazioni verificate nel codice, confermate dall'utente e ipotesi.

Documenti indicativi:

- `overview.md`
- `functional-spec.md`
- `architecture.md`
- `data-model.md`
- `integrations.md`
- `conventions.md`
- `development.md`
- `deployment.md`

La Project Discovery deve essere una procedura standard riutilizzabile, possibilmente attraverso una skill obbligatoria.

L'orchestratore deve impedire la creazione di feature finché la specifica di progetto non è approvata.

La documentazione deve essere versionata e mantenuta aggiornata durante l'evoluzione della codebase.

## 5. Feature Lifecycle

Ogni feature deve avere una specifica approvata prima dell'implementazione.

Workflow:

1. L'utente descrive la feature.
2. Il Project Architect analizza la richiesta e il contesto del progetto.
3. L'agente produce una specifica funzionale e tecnica, con criteri di accettazione.
4. L'utente approva il piano.
5. Maestro crea un branch dedicato e un Git Worktree a partire dal branch locale configurato.
6. Viene predisposto l'ambiente di esecuzione.
7. L'agente implementa la feature.
8. Vengono eseguiti i controlli previsti.
9. La sessione entra in stato *Ready for Review*.
10. L'utente approva l'integrazione.
11. Maestro esegue il merge nel branch locale di destinazione.
12. Il worktree viene eliminato quando è sicuro farlo.

Ogni feature deve poter contenere più sessioni e più run, eventualmente eseguiti con provider differenti.

Il merge deve essere sicuro, gestire i conflitti e non sovrascrivere modifiche locali dell'utente.

## 6. Git Worktrees e dipendenze

Utilizzare Git Worktrees per creare ambienti indipendenti, evitando cloni completi dei repository.

Ogni agente deve poter modificare la propria codebase e lavorare sul proprio branch.

Per progetti JavaScript/TypeScript, valutare pnpm e il suo content-addressable store per condividere i pacchetti identici, mantenendo una struttura `node_modules` logicamente indipendente per ciascun workspace.

Obiettivi:

- Minimizzare la duplicazione delle dipendenze.
- Evitare interferenze tra sessioni.
- Consentire lockfile differenti tra feature.
- Ridurre il tempo di preparazione dei workspace.
- Gestire processi, porte e cache separatamente.
- Preservare la compatibilità con repository esistenti.

Non imporre automaticamente pnpm ai progetti che utilizzano altri package manager: prevedere una strategia configurabile e potenzialmente estensibile ad altri ecosistemi.

Distinguere isolamento del workspace e isolamento di sicurezza: Git Worktrees non rappresenta una sandbox di sicurezza.

## 7. Multi-provider Architecture

Maestro deve avere un'interfaccia astratta per integrare provider differenti.

Provider target iniziali:

- Codex CLI.
- Claude Code.

Provider futuri:

- Gemini CLI.
- OpenCode.
- Altri agenti compatibili.

Ogni adapter dovrà gestire, in funzione delle capacità effettive del provider:

- Avvio delle sessioni.
- Ripresa delle sessioni.
- Interruzione e cancellazione.
- Streaming di eventi e output.
- Gestione degli errori.
- Rilevamento dei limiti di utilizzo.
- Eventuali informazioni sul reset delle quote.
- Configurazione di istruzioni, skill e strumenti.

Il modello dati di Maestro non deve dipendere dal formato delle sessioni di uno specifico provider.

### Provider Failover

Prevedere policy configurabili:

- **Sticky:** utilizza il provider scelto e attende il suo ripristino.
- **Fallback:** passa a un provider alternativo se quello principale diventa indisponibile.
- **Cost-aware:** seleziona un provider compatibile considerando disponibilità e costi.

In caso di passaggio tra provider, Maestro dovrà produrre un checkpoint portabile della feature e delle attività svolte.

Non assumere che la memoria conversazionale interna sia trasferibile direttamente tra provider.

Quando un provider raggiunge un limite temporaneo, la sessione potrà entrare in uno stato di attesa e riprendere quando torna disponibile, se tecnicamente supportato.

Considerare che disponibilità, quote e timestamp di reset potrebbero non essere esposti in maniera uniforme.

Il sistema deve utilizzare soltanto interfacce di autenticazione e integrazione supportate dai provider.

## 8. Agent Profiles, Skills & Tools

Prevedere profili di agenti riutilizzabili.

Profili iniziali proposti:

- Project Architect.
- Frontend Engineer.
- Backend Engineer.
- QA Engineer.
- Code Reviewer.
- Release Manager.

Un Agent Profile definisce:

- Istruzioni e comportamento atteso.
- Provider preferito e fallback.
- Skill obbligatorie e raccomandate.
- Tool disponibili.
- Permessi.
- Procedure di validazione.
- Vincoli operativi.

Le skill devono essere riutilizzabili tra progetti e sessioni, preferibilmente usando lo standard `SKILL.md`.

Prevedere un registry locale con skill globali, specifiche del progetto e associate al profilo.

Il sistema deve poter suggerire strumenti e skill e consentirne l'installazione/configurazione a runtime, previa autorizzazione e verifica della provenienza.

Le regole critiche devono essere imposte dall'orchestratore, non soltanto tramite prompt.

## 9. Review, Merge & Release

Dopo l'implementazione:

- Analizzare diff e commit.
- Eseguire test e controlli previsti.
- Verificare i criteri di accettazione.
- Aggiornare, se necessario, la documentazione.
- Gestire conflitti Git.
- Integrare nel branch locale configurato.

Dopo il merge locale, un agente generale con profilo *Release Manager* dovrà gestire la pubblicazione remota.

Il workflow deve distinguere:

1. Merge locale.
2. Push su origin.
3. Eventuale CI/CD.
4. Eventuale deployment in produzione.

Il push non equivale necessariamente a un deployment.

Il sistema deve supportare policy manuali e automatiche, ma utilizzare approvazione esplicita come default per operazioni di pubblicazione.

Non eseguire force push, deploy o modifiche distruttive senza autorizzazione appropriata.

Considerare anche repository con branch protetti o workflow basati su pull request.

## 10. Persistenza, lifecycle e resilienza

Questa è una priorità architetturale.

Il daemon deve mantenere uno stato persistente di:

- Progetti.
- Specifiche e relative versioni.
- Feature.
- Worktrees.
- Sessioni.
- Run.
- Provider.
- Processi.
- Eventi.
- Job pianificati.
- Operazioni Git e release.

SQLite è una possibile soluzione iniziale, da valutare.

Requisiti essenziali:

- Riavvio del daemon senza perdita dello stato logico.
- Riconciliazione tra database, processi e filesystem.
- Recupero di operazioni interrotte.
- Nessuna sessione duplicata accidentalmente.
- Gestione dei processi orfani.
- Shutdown controllato.
- Logging strutturato.
- Eventi osservabili dai client.
- Stato esplicito delle operazioni fallite o in attesa.

Progettare una state machine chiara, evitando logiche implicite distribuite tra moduli.

## 11. Performance e gestione delle risorse

Maestro deve introdurre un overhead minimo rispetto ai processi degli agenti.

Valutare:

- Numero massimo di sessioni attive.
- Scheduling dei processi.
- Limiti di concorrenza per installazioni, test e build.
- Gestione dei processi idle.
- Cache e deduplicazione delle dipendenze.
- Monitoraggio CPU, RAM e disco.
- Cleanup degli ambienti temporanei.
- Gestione di cache e lock.
- Prestazioni con diversi progetti e worktree attivi.

Evitare ottimizzazioni premature: individuare benchmark misurabili e scegliere soluzioni in base ai risultati.

## 12. Scope della prima milestone

La prima milestone riguarda esclusivamente **Maestro Core**.

L'obiettivo è arrivare a una versione headless utilizzabile tramite CLI o API locali.

Funzionalità minime da pianificare:

1. Avvio e arresto affidabile del daemon Node.js.
2. Registrazione e gestione dei progetti Git locali.
3. Persistenza dello stato con SQLite o alternativa motivata.
4. Contratti per provider adapter e primo provider funzionante.
5. Gestione di processi e output streaming.
6. Project Discovery con documentazione e approvazione.
7. Creazione di feature e Git Worktrees.
8. Predisposizione delle dipendenze per progetti pnpm.
9. Avvio e monitoraggio di sessioni indipendenti.
10. Persistenza e recovery delle sessioni.
11. Review delle modifiche e merge locale controllato.

Per evitare eccessiva complessità, valutare una realizzazione incrementale della milestone, partendo dalle primitive del daemon.

Non implementare immediatamente:

- Interfaccia Electron.
- Failover automatico avanzato.
- Deployment automatico.
- Marketplace completo delle skill.
- Sandbox basate su container o microVM.
- Ottimizzazioni sofisticate delle build cache.

Questi elementi devono però essere considerati nelle scelte architetturali iniziali, senza costruire anticipatamente l'intera infrastruttura.

## 13. Cosa mi aspetto da questa fase di planning

**Non iniziare a implementare.**

Produci un piano tecnico dettagliato per una nuova implementazione di Maestro.

### A. Greenfield Architecture Assessment

- Proponi una nuova architettura senza vincoli derivanti dalla precedente implementazione.
- Individua i confini tra moduli e responsabilità.
- Valuta i principali trade-off tecnologici.
- Definisci una strategia di bootstrap del nuovo progetto.
- Prevedi la rimozione della vecchia implementazione dopo un controllo dei file da preservare.

Non dedicare attività al recupero, al refactoring o alla migrazione del vecchio codice.

### B. Proposed Architecture

- Moduli e responsabilità.
- Confini tra i componenti.
- Comunicazione interna.
- API locali e streaming eventi.
- Modello di persistenza.
- State machine di feature, sessioni e run.
- Lifecycle del daemon.
- Strategia di isolamento e gestione processi.
- Interfaccia dei provider adapter.
- Separazione futura tra core ed Electron.

### C. Data Model

Proporre entità, relazioni e principali campi per Project, ProjectSpecification, Feature, FeatureSpecification, AgentProfile, Skill, Session, Run, Worktree, Event e Release.

Indicare gli invarianti da rispettare e le principali transizioni di stato.

### D. Implementation Roadmap

Suddividere il lavoro in milestone e task piccoli, verificabili e ordinati secondo le dipendenze.

Per ogni task indicare:

- Obiettivo.
- Moduli e file coinvolti.
- Dipendenze.
- Complessità stimata.
- Rischi.
- Criteri di accettazione.
- Test previsti.

### E. Technical Decisions

Proporre le tecnologie e le librerie più appropriate, motivando le scelte.

Prestare particolare attenzione a:

- Node.js/TypeScript.
- Daemon lifecycle.
- Process supervision e PTY.
- SQLite.
- Git Worktrees.
- pnpm.
- IPC/API locali.
- Event streaming.
- Testing e osservabilità.

Non introdurre framework complessi se non apportano un beneficio concreto.

### F. Risks & Open Questions

Identificare le decisioni tecniche ancora aperte, classificandole per impatto e urgenza.

Quando possibile, proporre una raccomandazione invece di limitarti a elencare alternative.

### G. First Implementation Slice

Concludere proponendo il primo incremento tecnico concretamente implementabile.

Deve essere piccolo, testabile e costituire una base solida per i successivi sviluppi.

Includere i comandi necessari per verificarlo e definire chiaramente cosa significa considerarlo completato.

---

## 14. Principi architetturali

Seguire queste linee guida:

1. **Core first:** il daemon deve funzionare indipendentemente dalla futura UI.
2. **Local-first:** repository, stato e processi rimangono locali.
3. **Provider agnostic:** nessuna dipendenza strutturale da un unico provider.
4. **Explicit state:** lifecycle e transizioni formalizzate.
5. **Recovery by design:** considerare crash e riavvii fin dall'inizio.
6. **Git safety:** non perdere mai modifiche dell'utente.
7. **Resource efficiency:** minimizzare duplicazioni e processi superflui.
8. **Human approval:** punti di approvazione espliciti per azioni rilevanti.
9. **Extensibility:** skill, profili e adapter modulari.
10. **Incremental delivery:** funzionalità end-to-end verificabili, evitando una riscrittura monolitica.

## 15. Istruzione finale

Utilizza questo documento come visione target, non come prescrizione rigida su ogni dettaglio implementativo.

Progetta Maestro da zero, scegliendo l'architettura più appropriata per i requisiti descritti.

Il repository attuale non rappresenta una base architetturale da mantenere.

Non limitarti a produrre una roadmap generica: il piano deve essere tecnicamente concreto, con moduli, contratti, struttura delle directory, dipendenze e criteri di accettazione.

**Output richiesto:**

Un piano di implementazione dettagliato, tecnicamente motivato, suddiviso in fasi e pronto per essere successivamente eseguito da agenti di coding.

Non modificare file, installare dipendenze, cancellare la vecchia implementazione o avviare attività di sviluppo durante questa fase, salvo successiva autorizzazione esplicita