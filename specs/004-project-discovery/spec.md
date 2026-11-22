# Feature Specification: Project Discovery & First Agent Session

**Feature Branch**: `004-project-discovery`
**Created**: 2026-11-15
**Status**: Draft — pronta per review
**Input**: Dopo importazione e verifica del progetto, rendere utilizzabile il prossimo passaggio del product brief: prima sessione agente reale per Project Discovery, documentazione e approvazione. Incremento minimo, senza implementazione di feature o benchmark prematuri.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Avviare la prima analisi del progetto (Priority: P1)

Come sviluppatore seleziono un progetto importato e avvio una Discovery con il profilo Project Architect e un provider disponibile, comprendendo quali dati saranno analizzati e quali permessi concedo.

**Why this priority**: Trasforma il registro in uno strumento che comprende il progetto usando un agente reale, come richiesto dal brief prima della creazione delle feature.

**Independent Test**: Con un repository locale di prova e un provider configurato, avviare dalla UI e dal client headless un’analisi reale; verificare sessione identificabile e repository invariato.

**Acceptance Scenarios**:

1. **Given** progetto registrato, servizio attivo e provider compatibile disponibile, **When** confermo progetto, provider e ambito di lettura, **Then** parte una sola sessione Discovery e ne ricevo l’identità prima di seguirne l’esito.
2. **Given** provider assente, autenticazione mancante o capacità di sola lettura non garantita, **When** richiedo l’avvio, **Then** vedo la causa e l’azione necessaria; non viene simulata una sessione funzionante né ampliato il permesso.
3. **Given** doppio invio oppure Discovery già attiva, **When** richiedo nuovamente l’avvio, **Then** recupero l’operazione originale o ricevo un blocco esplicito, senza un secondo processo agente.
4. **Given** checkout dirty, con conflitti o senza commit, **When** avvio l’analisi consentita in lettura, **Then** tale contesto è dichiarato e file, riferimenti Git e modifiche locali restano invariati.

### User Story 2 - Seguire l’analisi e rispondere all’architetto (Priority: P1)

Come sviluppatore seguo stato e output della Discovery e rispondo alle informazioni che l’agente non può ricavare dal codice, anche dopo la riapertura dell’app.

**Why this priority**: L’analisi deve essere utile e interrogabile, non un comando opaco; conoscenza del codice e indicazioni dell’utente hanno provenienze diverse.

**Independent Test**: Far emergere una domanda su una fixture con contesto incompleto, chiudere e riaprire la UI, ritrovare domanda/output e inviare una risposta associata alla stessa sessione.

**Acceptance Scenarios**:

1. **Given** analisi avviata, **When** apro il progetto, **Then** vedo stato corrente, sessione/run, avanzamento disponibile e output leggibile, senza richiedere un terminale generico.
2. **Given** informazioni non ricavabili dal repository, **When** l’agente chiede chiarimenti, **Then** la domanda è conservata con stato di attesa e le risposte intenzionali dell’utente mantengono la propria provenienza; la stessa risposta non viene applicata due volte.
3. **Given** sessione attiva o in attesa, **When** chiudo la UI o disconnetto un client, **Then** il lavoro accettato e le domande restano nel servizio; alla riapertura ritrovo la stessa Discovery.
4. **Given** richiesta di annullamento, errore del provider o riavvio del servizio, **When** consulto l’esito, **Then** vedo cancellazione, errore, interruzione o necessità di riconciliazione; output parziale conservato, nessun riavvio alla cieca o successo inventato.

### User Story 3 - Rivedere e approvare la conoscenza del progetto (Priority: P1)

Come sviluppatore leggo una bozza strutturata, distinguo evidenze, informazioni confermate e ipotesi, richiedo correzioni e approvo una precisa versione della specifica di progetto.

**Why this priority**: Nel brief l’approvazione della Project Discovery è il prerequisito per poter creare feature. Completamento dell’agente e approvazione dell’utente sono esiti diversi.

**Independent Test**: Produrre una bozza, correggere un’informazione attraverso l’intervista e approvare la nuova versione; dimostrare che il core considera idonea soltanto la versione esplicitamente approvata sul contesto corrente.

**Acceptance Scenarios**:

1. **Given** analisi conclusa, **When** rivedo la bozza, **Then** trovo scopo/funzionalità, architettura e dipendenze, convenzioni e procedure operative, con fonti per le evidenze, risposte utente e ipotesi chiaramente distinte.
2. **Given** bozza inesatta o informazioni mancanti, **When** invio una correzione o una risposta, **Then** ottengo una nuova revisione riconoscibile senza riscrivere la storia o trasformare automaticamente ipotesi in fatti.
3. **Given** bozza rivedibile e contesto coerente, **When** approvo la versione mostrata, **Then** il core registra progetto, revisione della documentazione, contesto e approvazione; nessuna approvazione è dedotta dall’esito positivo dell’agente.
4. **Given** bozza assente, incompleta, non approvata o obsoleta, **When** interrogo l’idoneità del progetto per il successivo percorso feature, **Then** il core la nega con una motivazione. In questa feature non viene ancora offerta la creazione di feature di sviluppo.

### User Story 4 - Aggiornare la Discovery senza perdere le approvazioni precedenti (Priority: P2)

Come sviluppatore riconosco quando la documentazione non descrive più il contesto analizzato e posso richiedere una nuova Discovery, conservando versioni ed esiti precedenti.

**Why this priority**: Una specifica approvata non deve diventare un’autorizzazione permanente su codice o documenti diversi.

**Independent Test**: Dopo l’approvazione modificare un input analizzato o la configurazione del progetto; verificare obsolescenza, idoneità negata e necessità di una nuova approvazione.

**Acceptance Scenarios**:

1. **Given** specifica approvata, **When** prima del suo utilizzo cambiano identità del checkout, revisione configurazione, documentazione o contenuti effettivamente analizzati, **Then** il contesto è rivalidato e l’approvazione precedente non autorizza quello nuovo.
2. **Given** modifica rilevante durante l’analisi o prima dell’approvazione, **When** arriva un risultato tardivo, **Then** viene conservato come non corrente o rifiutato, senza essere applicato al nuovo contesto.
3. **Given** progetto rimosso e poi reimportato, oppure archivio UI cambiato, **When** consulto sessioni e risultati, **Then** documenti e approvazioni rimangono associati all’identità originale, senza trasferimenti impliciti.

### Edge Cases

- Annullamento della conferma, doppio clic, risposta persa prima o dopo l’accettazione; query dell’UUID originale prima di ogni nuovo invio.
- Checkout spostato, identità cambiata, branch o file analizzati modificati, file non tracciati e informazioni mancanti.
- Provider non installato/non autenticato, versione o capacità incompatibile, quota esaurita, uscita anomala, domanda o risultato malformato.
- Domande senza risposta, risposta «non so», correzione di un’ipotesi, output incompleto o troncato; nessuna finta evidenza.
- Istruzioni ostili nel repository o nell’output agente, file esclusi dall’ambito autorizzato, tentativi di scrittura o esecuzione di comandi oltre la lettura consentita.
- Crash di client, agente o servizio; processo ancora vivo ma proprietà incerta, callback tardive e risultato di una vecchia generazione.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Il sistema DEVE offrire Avvia Discovery su un progetto registrato, usando il profilo iniziale Project Architect e un primo provider reale compatibile. La stessa funzione deve essere utilizzabile dalla UI e senza UI, attraverso il core.
- **FR-002**: Prima dell’avvio l’utente DEVE conoscere e confermare progetto/checkout, provider, ambito dei dati leggibili e permessi. L’eventuale invio del contesto al provider scelto deve essere dichiarato; nessuna autenticazione, installazione o ampliamento di accesso implicito.
- **FR-003**: L’integrazione del provider DEVE dichiarare capacità e prerequisiti effettivi, distinguendo disponibilità, autenticazione, avvio, interazione, cancellazione e ripresa. Capacità mancanti devono produrre un limite o blocco esplicito. Il dominio non deve dipendere dal formato proprietario del provider.
- **FR-004**: La Discovery DEVE analizzare in sola lettura l’ambito autorizzato. La policy deve essere applicata oltre alle istruzioni del prompt; scritture al repository, installazioni, esecuzione di codice del progetto e mutazioni Git non appartengono all’autorizzazione Discovery. Se tale limite non è garantibile, l’avvio resta bloccato.
- **FR-005**: L’avvio DEVE avere identità durevole prima dell’effetto esterno. Retry della stessa intenzione non duplicano sessioni/run; esiti sconosciuti restano interrogabili. Per questo incremento è ammessa una sola Discovery attiva per servizio, comprese le attese e le riconciliazioni incerte.
- **FR-006**: Sessione e run DEVONO esporre stati persistenti e transizioni distinguibili per attesa avvio, esecuzione, attesa risposta, completamento, errore, annullamento, interruzione e riconciliazione. Un agente terminato non implica documentazione approvata.
- **FR-007**: Il servizio DEVE conservare output utile, domande, risposte ed esiti con correlazione a progetto/sessione/run. La UI deve presentare testo inerte e distinguere avanzamento, attesa utente, problema e output parziale; limiti e troncamenti devono essere visibili.
- **FR-008**: L’intervista DEVE raccogliere informazioni non desumibili dal codice e permettere risposta, correzione o dichiarazione esplicita di informazione sconosciuta. Le risposte sono associate alla domanda e alla Discovery; non diventano istruzioni operative con permessi maggiori.
- **FR-009**: La bozza DEVE coprire almeno: scopo e funzionalità esistenti; stack, moduli, dati/dipendenze e integrazioni rilevanti; convenzioni e procedure di sviluppo, verifica, avvio e deployment conosciute. Informazioni assenti/non applicabili sono dichiarate, non inventate. Non è obbligatorio produrre otto file separati.
- **FR-010**: La documentazione DEVE distinguere evidenze ricavate dal codice con riferimenti controllabili, informazioni confermate dall’utente e ipotesi. Ogni revisione mantiene identità, provenienza e contesto analizzato; output incompleto o non validabile non è presentato come pronto per approvazione.
- **FR-011**: L’utente DEVE poter rivedere, correggere e approvare una precisa revisione. L’approvazione è registrata e verificata dal core, legata all’identità progetto, configurazione, documentazione e contesto corrente. Domande ancora aperte o informazioni sconosciute richiedono risoluzione o accettazione esplicita dell’incertezza prima dell’approvazione.
- **FR-012**: Il core DEVE esporre l’idoneità del progetto al futuro percorso feature e negarla in assenza di specifica approvata e corrente. Una precedente Verifica repository positiva o una Discovery completata non sostituiscono questo gate. La creazione/implementazione di feature è fuori scope004.
- **FR-013**: Prima di approvazione o utilizzo della specifica il sistema DEVE confrontare il contesto corrente con quello effettivamente analizzato, includendo identità checkout, configurazione e input letti anche non committati. Cambi rilevanti invalidano l’utilizzabilità dell’approvazione precedente; le versioni storiche restano consultabili.
- **FR-014**: Chiusura della UI o disconnessione del client NON DEVONO arrestare la sessione accettata. Alla riapertura si recuperano identità, stato, domande e risultati originali; cambio archivio non trasferisce né cancella il lavoro.
- **FR-015**: Dopo crash o riavvio il core DEVE riconciliare stato, identità dei processi ed eventuali riferimenti provider prima di dichiarare esito o consentire nuova esecuzione. Nessun avvio/ripresa duplicato o segnale a processi dalla proprietà incerta. La policy Agent Runtime è dedicata e non eredita obbligatoriamente la terminazione degli ausiliari Foundation.
- **FR-016**: L’utente DEVE poter richiedere l’annullamento di una sessione. Il sistema comunica se la cessazione è verificata, in corso, non supportata o incerta; conserva risultato parziale e distingue la chiusura del processo locale dall’eventuale lavoro remoto non verificabile.
- **FR-017**: Una nuova Discovery DEVE essere intenzionale e preservare documenti, approvazioni ed esiti precedenti. Ripresa dello stesso contesto è consentita solo con capacità provider effettiva, riconciliazione riuscita e autorizzazione ancora valida; nessun failover automatico in questo incremento.
- **FR-018**: Credenziali dell’orchestratore/provider e dati esclusi dall’ambito NON DEVONO essere esposti a UI, documentazione, log o contesto inviato all’agente. Errori normalizzati non contengono segreti o stderr tecnico grezzo. Il contenuto autorizzato della documentazione/output è distinto dalla diagnostica operativa.

### Non-functional Requirements

- **NFR-001**: Stato, documenti, domande e approvazioni risiedono localmente e sono consultabili senza servizio cloud Maestro. La rete è richiesta solo per l’integrazione provider che ne dipende; indisponibilità non elimina i dati locali.
- **NFR-002**: Prima piattaforma qualificata e confini core/client restano quelli attuali. Nessun secondo daemon, orchestrazione nel renderer o dipendenza del core dalla UI. Il primo provider può essere unico, ma capacità e dominio devono permettere ulteriori adapter senza riscrivere Discovery e approvazioni.
- **NFR-003**: Il piano DEVE fissare limiti numerici verificabili per output/documenti/domande, processi, code, attese e cancellazione; superamento, troncamento e incertezza sono osservabili. Per l’MVP bastano casi funzionali e fault mirati, senza nuove campagne di volume o durata.
- **NFR-004**: Test automatici del core non richiedono UI, credenziali reali o servizi esterni. La qualifica del primo provider richiede inoltre una prova reale esplicitamente autorizzata su repository di test e autenticazione supportata; un provider simulato non dimostra l’integrazione reale.
- **NFR-005**: UI, output e revisione devono essere navigabili da tastiera, con errori comprensibili, provenienza e stato visibili. Nessun controllo deve suggerire che l’analisi o l’approvazione abbiano già modificato il codice.

### Key Entities

- **Discovery**: analisi di uno specifico progetto/checkout e del contesto autorizzato, con identità e stato persistenti.
- **Sessione / Run**: lavoro logico dell’architetto e singolo tentativo effettivo, correlati al provider scelto e al processo/risultato osservato.
- **Disponibilità provider**: prerequisiti, capacità reali e cause di indisponibilità; distinta dalle credenziali gestite dal provider.
- **Domanda / Risposta**: informazione mancante e contributo intenzionale dell’utente, con provenienza e collegamento al contesto.
- **Revisione della specifica di progetto**: documentazione strutturata, evidenze, conferme, ipotesi e informazioni assenti, con cronologia conservata.
- **Approvazione / Idoneità**: decisione esplicita su una revisione e un contesto; esito corrente verificato dal core per il futuro percorso feature.

### Constitutional Invariants & Required Tests *(mandatory)*

- **I–II, local-first e core headless**: integrazione locale e UI su avvio, consultazione, domanda persistita e chiusura/riapertura client con stesso lavoro superstite. Consultazione senza rete/provider; tutti i percorsi critici del core verificabili senza UI.
- **III, provider agnostic**: contratti su capacità mancanti, autenticazione assente, output malformato, errore/quota e ripresa non supportata. Adapter simulato nei test automatici e un primo provider reale qualificato separatamente; nessuna sessione finta presentata come integrazione completata.
- **IV, Git safety**: integrazione con repository reali clean/dirty/conflitti/unborn e snapshot di file/riferimenti prima/dopo analisi, intervista, errori e cancellazione. Tentativi di scrittura/esecuzione fuori ambito e istruzioni ostili devono essere negati dai controlli effettivi. Nessun worktree necessario per questa analisi in sola lettura; un worktree non sostituirebbe il controllo dei permessi.
- **V, recovery**: unitari sulle transizioni, contratti di idempotenza e integrazioni su doppio invio, perdita risposta, crash agente/servizio, callback tardive e proprietà incerta. Nessuna seconda esecuzione né terminazione di processi estranei; risultati parziali conservati.
- **VI, approvazioni**: unitari e contratti su avvio non confermato, revisione documento o contesto cambiati, domanda ancora aperta e progetto reimportato. Il core nega idoneità senza approvazione attuale; un client alternativo non può aggirarla.
- **VII–VIII, testabilità e osservabilità**: test di correlazione domanda/output/documenti, redazione, contenuti ostili, limiti e consumer disconnesso. Test automatici mirati con fixture locali, senza benchmark sproporzionati. Evidenza reale provider distinta da simulazioni e da gate esterni preesistenti.
- **Non applicabile in004**: implementazione concorrente di codice, creazione worktree, installazioni dei progetti, merge/cleanup, release/deploy e failover avanzato. Nessuna di queste azioni è autorizzata dalla Discovery o dalla sua approvazione.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Con un provider reale configurato, su un repository di test l’utente completa dalla UI avvio Discovery → analisi → risposta a un chiarimento → revisione → approvazione. Stato e documentazione sono ritrovabili anche attraverso il client headless; riferimenti e screenshot/esiti della prova sono conservati senza segreti.
- **SC-002**: Sullo stesso percorso, il 100% delle sezioni richieste della bozza è presente o esplicitamente dichiarato non applicabile/sconosciuto; nessuna affermazione priva di evidenza o conferma è etichettata come verificata.
- **SC-003**: Nei casi mirati di doppio invio, risposta persa, chiusura UI e riavvio del servizio non compare una seconda esecuzione non autorizzata. Domande, risposte, output disponibile e identità originali restano interrogabili.
- **SC-004**: Tutti i tentativi di approvare o dichiarare idonea una revisione assente/non approvata, un contesto obsoleto o l’identità di un altro progetto sono negati dal core; una nuova approvazione valida rende idonea soltanto la revisione corrente.
- **SC-005**: Gli snapshot dei repository di prova restano invariati nel 100% dei percorsi Discovery, inclusi dirty/conflitti, errore e annullamento. I tentativi di uscire dai permessi di lettura falliscono senza trasformarsi in una richiesta operativa autorizzata.
- **SC-006**: I casi provider assente/non autenticato, capacità incompatibile, output invalido e quota esaurita mostrano uno stato e un’azione comprensibili; nessuno produce un falso completamento o un fallback non richiesto.
- **SC-007**: I flussi avvio/intervista/review/approvazione/cancellazione sono completabili da tastiera; prove mirate dimostrano limiti e troncamenti espliciti e assenza di credenziali nei dati esposti. Tempi dipendenti dal provider vengono riportati come misure della prova, senza soglie di throughput o durata dell’analisi inventate.

## Assumptions

- Riferimenti: product brief §§3–4,7–8,10,12; Constitution1.0.0. Il passo successivo del prodotto è Discovery, prima della creazione delle feature; la prima sessione è analitica, non di implementazione.
- Primo incremento: un provider reale e un profilo Project Architect dedicato alla procedura Discovery. Scelta del primo provider fra i target del brief, interfacce supportate e verifica dei permessi appartengono al piano tecnico; non sono presunte capacità specifiche di un prodotto.
- Configurazione/autenticazione del provider avviene tramite modalità ufficialmente supportate e azione esplicita dell’utente. Questo documento non autorizza chiamate reali, spesa, installazioni o lettura di credenziali durante la specificazione.
- Le revisioni documentali vengono conservate nell’archivio locale Maestro e consultate dalla UI/client. Export nel repository e versionamento tramite commit Git sono rinviati; non si modifica il checkout per produrre la bozza.
- Nessun editor di profili, registry generale skill/tool, terminale, worktree, gestione dipendenze, creazione di feature di codice, merge/release o failover automatico. Ripresa provider condizionale alle capacità reali; nessuna promessa di trasferire memoria proprietaria.
- Base di lavoro003 al commitaad9dde, con dipendenze001/002 già integrate localmente. Il branch004 nasce da003 senza merge in main. La review manuale003 e i gate001/T082,001/T085,002/T093 restano distinti e aperti; la presente specifica non li promuove a PASS.

## Clarifications

### Session 2026-11-15

- Q: Primo provider per la Discovery, considerando autenticazione e modalità di isolamento? → A: Codex CLI con login ufficiale. Il piano sceglie il profilo Keychain-only e non introduce API key Anthropic o fallback automatico.
