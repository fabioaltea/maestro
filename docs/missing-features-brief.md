# Maestro — Brief delle feature mancanti

**Data**: 2026-11-19 · **Stato**: proposta di prodotto e progettazione; implementazione non avviata.
**Fonti**: [visione originale](product-brief.md), [Constitution](../.specify/memory/constitution.md), specifiche e report 001–004 nel checkout `d798a94`.

## Obiettivo

Completare il percorso Discovery → pianificazione → esecuzione → review → integrazione locale → pubblicazione, mantenendo stato, policy e supervisione nel core headless. Il desktop esistente espone gli stessi comandi e gli stessi esiti della CLI.

La richiesta attuale autorizza la scrittura di brief, specifiche, piani e task. L'indicazione greenfield del brief originale riguarda la precedente implementazione sperimentale: non richiede una seconda riscrittura delle feature 001–004 ora implementate. Non si pianifica un nuovo cleanup della base corrente.

## Stato verificato e debito esistente

| Area | Disponibilità locale | Qualifica ancora aperta |
|---|---|---|
| 001 Foundation | Daemon, persistenza, lifecycle, eventi e contratti locali | T082/T085: gate esterni; nessuna deroga |
| 002 Project Registry | Import, letture, verifica, aggiornamento/rimozione metadati | T093: secondo UID/IP-denied; readiness BLOCKED |
| 003 Desktop | Client locale e flussi del registro | T054: review umana/picker; campagne volume/durata DEFERRED |
| 004 Discovery | Corpus, intervista, documenti, approvazione/freshness e UI | T028/T050: login/provider reale PROVIDER_UNSAFE; SC-001 non dimostrato; una failure core non risolta nell'ultimo run |

Le checkbox concluse e i test con fixture non certificano provider o release. Questi debiti restano nei pacchetti originali: non vengono rinumerati come nuove feature né marcati PASS. Nessuna nuova campagna lunga è aggiunta.

## Incrementi mancanti

| ID | Feature e valore | Primo incremento utile | Dipendenze funzionali |
|---|---|---|---|
| 005 | [Feature Planning](../specs/005-feature-planning/brief.md): richiesta, specifica, piano e approvazione versionati | Authoring manuale e gate Discovery attuale; generazione assistita solo dopo qualifica | 004 |
| 006 | [Git Workspaces](../specs/006-git-workspaces/brief.md): branch e worktree posseduti senza sovrascrivere lavoro | Un workspace per feature approvata, recovery e rimozione sicura | 005, 002 |
| 007 | [Workspace Environments](../specs/007-workspace-environments/brief.md): dipendenze isolate e preparazione ripetibile | Adapter pnpm qualificato; altri ecosistemi esplicitamente manuali | 006 |
| 008 | [Agent Profiles](../specs/008-agent-profiles/brief.md): istruzioni, skill, tool e permessi riproducibili | Registry locale versionato e risoluzione di un profilo | 004; nessun runtime necessario |
| 009 | [Agent Execution](../specs/009-agent-execution/brief.md): sessioni, run, output e checkpoint | Un agente Codex in workspace autorizzato; Claude adapter con qualifica indipendente | 005–008 |
| 010 | [Session Scheduling](../specs/010-session-scheduling/brief.md): coda, limiti risorse, attesa e cambio provider | Sticky e coda persistente; fallback/cost-aware solo con capacità e dati disponibili | 009; Discovery conserva i propri gate |
| 011 | [Review & Local Merge](../specs/011-review-local-merge/brief.md): prove, diff e integrazione approvata | Review corrente e merge locale su target riservato | 005, 006, 009; scheduling avanzato non necessario al caso singolo |
| 012 | [Release Publishing](../specs/012-release-publishing/brief.md): push, PR, CI e deployment distinti | Push esplicito su origin con recovery; PR/CI/deploy per adapter configurati | 011, 008 |

Ogni riga è una singola esecuzione logica specify → plan → tasks. Numerazione e branch separano i pacchetti; i branch di progettazione sono creati in sequenza e l'ultimo contiene tutti i documenti precedenti. I task di implementazione restano aperti.

## Esperienza e confini

L'utente importa il progetto, completa e approva Discovery, descrive una feature e approva una revisione del piano. Maestro prepara workspace e ambiente, risolve un profilo immutabile e avvia una sessione. Chiusura UI, indisponibilità provider e crash producono stati osservabili; una ripresa crea una generazione identificata e non ripete effetti incerti. Review e integrazione locale richiedono evidenze correnti. La pubblicazione usa un'autorizzazione distinta; il deployment ha un ulteriore gate.

Generazione assistita 005 è separata dall'esecuzione 009 per evitare una dipendenza circolare. La 005 offre authoring manuale completo; l'approvazione Discovery necessaria alla creazione rimane obbligatoria e deve essere rivalidata dal core. Il login reale bloccato in 004 può quindi impedire il primo percorso reale anche se la progettazione e le prove con fixture sono complete.

Tutti i pacchetti includono CLI e il corrispondente flusso desktop sul core esistente. Terminale interattivo/PTY general purpose, collaborazione cloud, marketplace pubblico, Gemini/OpenCode, container/microVM, distribuzione firmata multipiattaforma e build cache sofisticate sono evoluzioni escluse da questa roadmap; non sono prerequisiti nascosti per l'MVP. Il monitoraggio iniziale usa output strutturato e comandi di validazione controllati. Pubblicazione e deployment automatici sono limitati a policy esplicite, revocabili e versionate.

## Ordine e criteri di consegna

Ordine dello schema/pacchetti: 005 → 006 → 007 → 008 → 009 → 010 → 011 → 012. La precedenza dello schema è distinta dalle dipendenze funzionali; non si implementano feature fuori ordine sullo stesso archivio. [Contratti trasversali](missing-features-contracts.md) definisce ledger, quote, upgrade, autorizzazioni e confini condivisi.

Primo slice: 005/US1, authoring locale con rifiuto della creazione se Discovery manca o è scaduta, idempotenza, stato leggibile headless/offline. Primo ciclo di sviluppo completo: 005–009 e 011 con provider reale qualificato. 010 aumenta concorrenza e resilienza; 012 aggiunge pubblicazione. Una review documentale PASS significa coerenza progettuale, mai autorizzazione all'implementazione o certificazione runtime.

La validazione avviene per scenario e per checkpoint con fault bounded, fixture locali e test invarianti esplicitamente richiesti. Login, installazioni, inferenza reale, push e deployment non sono eseguiti durante questa pianificazione.
