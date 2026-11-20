# Feature Specification: Un repository alla volta in Maestro

**Feature Branch**: `013-repository-first-desktop`  
**Created**: 2026-11-20  
**Status**: Draft  
**Input**: Aprire Maestro, aprire o creare un repository locale, analizzare la codebase e creare una nuova feature. Maestro gestisce l’archivio in una posizione privata del sistema.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Aprire o creare un repository (Priority: P1)

Come sviluppatore, apro Maestro e scelgo direttamente il repository su cui voglio lavorare. Posso anche inizializzarne uno nuovo in una cartella scelta da me. La vista successiva mostra il repository attivo e offre «Analizza codebase».

**Why this priority**: Il primo passo coincide con il lavoro da fare. Oggi serve configurare o scegliere un archivio, avviare il servizio e poi importare il repository.

**Independent Test**: Partire con un profilo senza dati. Aprire un checkout locale, verificare che la vista mostri il progetto e che i file siano invariati. Ripetere con «Crea repository» in una cartella vuota.

**Acceptance Scenarios**:

1. **Dato** Maestro appena aperto, **quando** la schermata iniziale è pronta, **allora** offre «Apri repository» e «Crea repository». I repository già aperti sono accessibili dai recenti.
2. **Dato** un checkout valido e accessibile, **quando** l’utente lo sceglie con «Apri repository», **allora** Maestro lo registra o ritrova nelle proprie risorse locali e mostra la vista del progetto con «Analizza codebase». Il flusso richiede soltanto la scelta del repository.
3. **Dato** un percorso nuovo o una cartella vuota, **quando** l’utente conferma «Crea repository» su quella destinazione, **allora** viene inizializzato un repository locale, anche senza commit, e Maestro lo apre. Un repository già esistente può essere aperto dalla stessa schermata dopo un avviso.
4. **Dato** un progetto già attivo, **quando** l’utente annulla la scelta o seleziona una cartella non utilizzabile, **allora** il progetto attivo resta selezionato. In caso di errore, Maestro descrive il problema e permette di riprovare.
5. **Dato** un archivio privato indisponibile, **quando** l’utente apre o crea un repository, **allora** Maestro mostra perché il progetto non può essere aperto e offre il recupero previsto per il problema. Se la creazione Git è già riuscita, mostra il percorso e permette di riaprire quello stesso repository.

### User Story 2 - Analizzare la codebase e aprire la prima feature (Priority: P1)

Come sviluppatore, vedo l’analisi come prossimo passo del progetto. Dopo aver controllato e approvato il contesto di Discovery, posso entrare in «Nuova feature» per lo stesso repository.

**Why this priority**: Portare l’utente direttamente alla feature richiede un passaggio visibile e coerente dal contesto della codebase, con lo stato delle approvazioni a portata di mano.

**Independent Test**: Con un progetto di prova aperto e un provider di fixture, partire da «Analizza codebase», confermare le fonti, rivedere il risultato e approvarlo. Verificare che «Nuova feature» apra l’editor del progetto e che la creazione usi quel contesto.

**Acceptance Scenarios**:

1. **Dato** un progetto alla prima apertura, **quando** l’utente sceglie «Analizza codebase», **allora** arriva alla preparazione di Discovery sul progetto attivo. Prima dell’avvio vede l’ambito e le fonti selezionate, oltre a destinatario e dati condivisi quando si usa un provider, e concede il consenso richiesto.
2. **Dato** un repository nuovo ancora privo di fonti idonee, **quando** l’utente apre l’analisi, **allora** Maestro chiarisce cosa serve per poterla avviare. Il progetto resta aperto e può essere rivalutato dopo che l’utente aggiunge i file.
3. **Dato** che l’analisi è in corso, in attesa di risposta o pronta per la revisione, **quando** l’utente torna al progetto, **allora** vede lo stato e può riprendere la sessione o la revisione esistente.
4. **Dato** un risultato approvato e ancora corrente, **quando** l’utente torna al progetto o completa l’approvazione, **allora** «Nuova feature» apre il percorso di creazione con progetto e contesto già selezionati.
5. **Dato** un contesto mancante, non approvato o obsoleto, **quando** l’utente cerca di creare una feature, **allora** vede il motivo e il prossimo passo, e il core nega la creazione. Se il provider è indisponibile o non qualificato, la pagina del progetto e la consultazione dei risultati precedenti restano utilizzabili.

### User Story 3 - Riaprire i progetti e ritrovare il lavoro (Priority: P2)

Come sviluppatore che lavora su più repository, posso passare dall’uno all’altro partendo dai recenti. Per ciascuno ritrovo analisi, feature e operazioni nel contesto giusto dopo aver chiuso e riaperto Maestro.

**Why this priority**: Uno spazio privato gestito da Maestro deve dare continuità al lavoro e togliere all’utente il compito di ricordare in quale archivio lo ha fatto.

**Independent Test**: Aprire due repository omonimi in percorsi differenti. Avviare una lettura sul primo e cambiare progetto prima della risposta. Riavviare il client e riaprire entrambi dai recenti, verificando identità, storico e stato.

**Acceptance Scenarios**:

1. **Dato** un repository già registrato, **quando** l’utente lo riapre da un percorso equivalente, da una sottocartella o da un altro worktree collegato supportato, **allora** ritrova lo stesso progetto e il suo storico. Il checkout di riferimento rimane quello già registrato e l’interfaccia lo rende riconoscibile se differisce dalla cartella scelta.
2. **Dati** due cloni distinti o due repository omonimi, **quando** l’utente li apre e passa dall’uno all’altro, **allora** i recenti li distinguono per percorso. Output, conferme pendenti e risposte tardive del primo restano associati al primo.
3. **Dato** un progetto già aperto in precedenza, **quando** Maestro viene chiuso e riaperto, **allora** il progetto è ancora nei recenti e lo storico registrato è consultabile. Con servizio fermo, i dati storici sono indicati come ultimo stato noto.
4. **Dato** un archivio generato da una versione precedente che l’utente vuole recuperare, **quando** lo presenta tramite il percorso di recupero, **allora** Maestro verifica e rende disponibili i dati se compatibili e se il proprio archivio è ancora vuoto. Se il recupero è bloccato, indica come consultare l’originale e conserva i dati esistenti.

### Edge Cases

- La scelta di cartella distingue repository valido, cartella ordinaria, checkout senza commit e repository senza checkout utilizzabile. Le modifiche locali, i conflitti e lo stato Git esistente sono preservati in apertura e in analisi.
- Se un repository recente è spostato, scollegato o sostituito da un altro allo stesso percorso, Maestro mostra l’ultimo stato noto e chiede di individuare di nuovo il repository. Solo un’identità verificata riprende lo storico precedente.
- Richieste concorrenti sulla stessa destinazione, interruzione tra creazione e registrazione, servizio in recovery e risposte perse lasciano un esito originale interrogabile. La ripetizione riusa quanto già creato oppure mostra un esito incerto da verificare.
- Cartella dati inaccessibile, piena, incompatibile o già in uso da un’altra istanza. Il recupero preserva lo stato precedente ed evita che un secondo archivio vuoto appaia come se contenesse lo storico.
- Provider indisponibile, fonti fuori ambito, consenso mancante e approvazione diventata obsoleta lasciano consultabili progetto e storico. La UI mostra il passo ancora necessario.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: All’apertura Maestro DEVE mostrare «Apri repository», «Crea repository» e, quando presenti, i repository recenti. Il percorso ordinario ha un solo progetto attivo e nessun controllo di configurazione o selezione dell’archivio.
- **FR-002**: Maestro DEVE determinare l’archivio locale durevole e privato del profilo utente, condiviso dai client ordinari. I dati autorevoli devono sopravvivere a chiusure e riavvii. Le risorse temporanee sono riservate ai dati rigenerabili. Un archivio indisponibile deve risultare esplicitamente bloccato.
- **FR-003**: La selezione esplicita di un repository valido DEVE aprire il progetto e includere, quando necessario, l’avvio del servizio locale e la registrazione tramite il core. Il primo avvio dell’app e la consultazione dello storico devono poter avvenire senza avvio del servizio. La gestione esplicita del servizio resta disponibile nella diagnostica.
- **FR-004**: «Apri repository» DEVE accettare checkout Git locali accessibili supportati dal registro esistente, inclusi worktree collegati e repository senza commit. L’apertura conserva configurazione, indice, riferimenti e file esistenti. Annullamento o selezione non valida preservano il progetto attivo.
- **FR-005**: «Crea repository» DEVE inizializzare e aprire un repository Git dopo conferma di una destinazione nuova o vuota. Deve preservare qualsiasi destinazione già occupata e gestire annullamento, esecuzioni concorrenti e recupero di una creazione completata solo in parte. Commit iniziale e collegamento remoto rimangono azioni dell’utente.
- **FR-006**: Alias, sottocartelle e worktree dello stesso repository DEVONO portare all’identità esistente. Cloni distinti DEVONO restare distinti. Maestro deve conservare il checkout di riferimento già registrato e verificare l’identità prima di ricongiungere un percorso spostato allo storico.
- **FR-007**: La vista del progetto DEVE offrire «Analizza codebase» come prossimo passo quando manca un contesto corrente. La vista propone la sessione esistente se ancora attiva o rivedibile, e mostra il motivo del blocco se mancano fonti, capacità del provider o autorizzazioni.
- **FR-008**: La Discovery DEVE riusare i gate esistenti di selezione delle fonti, consenso, revisione e approvazione. L’apertura o creazione del repository non costituisce consenso all’invio di dati. Il core deve rifiutare l’avvio senza ambito e consenso validi e considerare obsoleta un’approvazione quando cambia il contesto rilevante.
- **FR-009**: «Nuova feature» DEVE aprire il flusso della feature per il progetto attivo usando un contesto di Discovery approvato e corrente. Prima che tale condizione sia soddisfatta, la UI deve indicare il passo mancante e il core deve bloccare la creazione. Le feature già registrate restano consultabili.
- **FR-010**: Desktop DEVE mantenere cronologia e recenti per identità di progetto. Le viste di analisi, feature e lavoro partono dal progetto attivo. Le viste globali identificano il progetto di ogni esito. Risposte e conferme valgono per il progetto d’origine. Il cambio di progetto, il cambio di finestra e la chiusura del client lasciano proseguire le operazioni già ammesse, i cui esiti originali restano consultabili.
- **FR-011**: Il core DEVE offrire al client headless le stesse identità, stati e operazioni sui repository e sul contesto. L’apertura o creazione deve distinguere successo, già eseguito, errore ed esito incerto. Le operazioni devono essere ricostruibili per progetto senza registrare credenziali o contenuto del codice nei log.
- **FR-012**: Il recupero iniziale di un archivio preesistente DEVE essere accessibile dalle funzioni di recupero e conservare l’originale. Con archivio privato vuoto, è consentito acquisire un solo archivio compatibile verificato preservando identità, storico e ricevute. Se l’acquisizione è incompatibile, incerta o incontra uno stato già presente, lo storico originario deve restare accessibile tramite la consultazione headless supportata e Maestro deve spiegare l’esito.
- **FR-013**: Apertura, creazione, elenco recenti e passaggi tra analisi e feature DEVONO essere percorribili da tastiera. Lo stato e l’azione disponibile devono essere identificabili anche durante un errore o un’operazione in corso.

### Key Entities

- **Repository locale** — Cartella di lavoro Git riconosciuta dal registro. Percorsi equivalenti possono rappresentare la stessa identità.
- **Progetto** — Identità stabile con checkout di riferimento, stato della Discovery, feature e operazioni collegate.
- **Progetto attivo** — Contesto di lavoro corrente nel Desktop. Le viste delle operazioni globali mostrano chiaramente a quale progetto appartiene ciascun risultato.
- **Archivio privato** — Dati autorevoli locali del profilo utente. Contiene registro, storico, ricevute e risultato delle operazioni, mentre i repository restano nelle cartelle scelte dall’utente.
- **Contesto Discovery approvato** — Revisione del contesto della codebase che abilita la creazione di una feature finché resta corrente.

### Constitutional Invariants & Required Tests *(mandatory)*

| Principio | Verifica richiesta |
| --- | --- |
| I e II · Local-first e core headless | Integrazione locale su profilo vuoto e profilo con storico. Desktop e client headless ritrovano lo stesso progetto. Le consultazioni storiche funzionano a servizio fermo e la chiusura del client lascia proseguire le operazioni ammesse. |
| III e VI · Capacità e approvazioni | Unitari e contratti per provider assente o non qualificato, consenso o ambito mancanti, contesto obsoleto e azione indirizzata al progetto errato. L’apertura del progetto funziona in locale. Avvio di Discovery e creazione feature passano solo con i prerequisiti validi. |
| IV · Git safety | Integrazioni con checkout pulito, dirty, in conflitto, senza commit e con worktree collegati. Apertura e Discovery preservano file, indice e riferimenti. Inizializzazione su destinazione confermata, rifiuto su destinazione occupata. |
| V e VIII · Stato, recovery e osservabilità | Unitari, contratti e integrazioni con richieste concorrenti, timeout dopo inizializzazione, riavvio, risposte da un progetto deselezionato e recupero interrotto. Una sola registrazione per identità, esito originale interrogabile e log privi di contenuti del codice e credenziali. |
| VII · Testabilità | Suite del core con risorse temporanee e provider simulato, affiancata da prove Desktop end-to-end su apertura, creazione, Discovery, nuova feature e cambio progetto. Verifica manuale del picker e del percorso da tastiera. |

Implementazione di feature, gestione di worktree, integrazione Git, pubblicazione e deploy appartengono ai flussi già definiti. Le azioni di apertura, Discovery e creazione di una feature non attribuiscono le relative autorizzazioni.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In cinque prove a profilo vuoto con checkout validi e cinque con destinazioni nuove o vuote, tutte arrivano a «Analizza codebase» tramite la sola azione «Apri repository» o «Crea repository» e la relativa scelta o conferma del percorso. Zero richieste di configurazione dell’archivio o di avvio separato del servizio.
- **SC-002**: In dieci riaperture di repository già registrati, con servizio attivo e disco locale nelle condizioni di prova, la vista utilizzabile compare entro 2 secondi in almeno nove casi dopo la conferma della scelta. Percorsi equivalenti restituiscono sempre lo stesso progetto.
- **SC-003**: Con due progetti di prova, tutti i casi con Discovery approvata e corrente aprono «Nuova feature» sul progetto giusto. Tutti i casi con contesto mancante, non approvato, obsoleto o di un altro progetto sono bloccati e mostrano il passo necessario.
- **SC-004**: In dieci prove di cambio progetto, riavvio o ripetizione di una richiesta interrotta, si osservano zero duplicati, zero esiti associati all’altro progetto e zero modifiche non richieste ai repository.
- **SC-005**: Almeno cinque su sei partecipanti nuovi a Maestro raggiungono «Analizza codebase» al primo tentativo senza istruzioni. Almeno cinque su sei trovano «Nuova feature» dopo l’approvazione dell’analisi nella stessa sessione di prova.

## Assumptions

- L’archivio ordinario è persistente e privato per profilo utente. La collocazione è una decisione del piano, così come la gestione delle risorse temporanee. Un ripristino iniziale può adottare un solo archivio storico compatibile. La fusione di archivi è fuori ambito.
- «Apri repository» riguarda checkout Git locali accessibili. Clonazione remota, repository bare e inizializzazione di cartelle già popolate sono fuori ambito. Aprire un checkout senza commit è supportato indipendentemente dalla disponibilità di fonti per Discovery.
- Questa specifica sostituisce l’obbligo di scegliere o creare manualmente un archivio nelle schermate ordinarie di Desktop 003 e incorpora l’avvio locale necessario nella richiesta esplicita di apertura o creazione del repository. I comandi headless di servizio e le opzioni avanzate per archivi espliciti restano disponibili.
- Il registro 002, i gate di Discovery 004 e il percorso di creazione feature 005 sono dipendenze. Le prove del nuovo percorso usano fixture. La qualifica reale dei provider conserva i gate correnti.
