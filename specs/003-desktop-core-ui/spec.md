# Feature Specification: Desktop UI per il core attuale

**Feature Branch**: `003-desktop-core-ui`  
**Created**: 2026-11-11  
**Status**: Draft — pronta per review  
**Input**: Prima versione UI sul core 001 e 002, integrati prima della specifica; produrre anche piano e task, senza implementazione.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Consultare i progetti locali (Priority: P1)

Come sviluppatore apro Maestro, scelgo l'archivio locale e consulto elenco e dettaglio dei progetti senza usare il terminale.

**Why this priority**: È il primo incremento utile e rende visibile il core già disponibile.

**Independent Test**: Con archivio preparato dalla CLI, aprire la UI con daemon attivo e poi arrestato; consultare gli stessi progetti distinguendo stato corrente e ultimo stato conosciuto.

**Acceptance Scenarios**:

1. **Given** un archivio con 100 progetti, **When** apro e percorro l'elenco, **Then** posso raggiungere tutti i progetti senza duplicati e aprire i dettagli del progetto selezionato.
2. **Given** daemon arrestato e archivio leggibile, **When** consulto elenco e dettagli, **Then** vedo dati storici etichettati con provenienza/data senza avviare processi di servizio o aggiornare l'archivio.
3. **Given** archivio assente, inaccessibile o non compatibile, **When** lo seleziono, **Then** vedo una spiegazione e una possibile azione; nessun archivio viene creato o riparato implicitamente.
4. **Given** elenco cambiato durante la consultazione oppure risposta tardiva da un archivio precedente, **When** aggiorno la vista, **Then** non mescolo revisioni o archivi; riparto da un elenco coerente e segnalo l'aggiornamento.
5. **Given** osservazione vecchia o flag non verificati, **When** apro i dettagli, **Then** non vengono presentati come verifica corrente o assenza accertata di modifiche.

### User Story 2 - Controllare esplicitamente il daemon (Priority: P1)

Come sviluppatore avvio, arresto e riavvio il servizio da Maestro, comprendendo stato e operazioni in corso.

**Why this priority**: Rende la UI utilizzabile senza terminale mantenendo il servizio indipendente.

**Independent Test**: Da archivio temporaneo avviare il servizio, chiudere la UI, verificare dalla CLI che sia ancora attivo; riaprire e arrestarlo esplicitamente.

**Acceptance Scenarios**:

1. **Given** servizio assente, **When** confermo Avvia sull'archivio selezionato, **Then** il servizio si avvia o viene mostrato un errore motivato; clic ripetuti non generano più istanze.
2. **Given** servizio attivo, **When** chiudo finestra/applicazione oppure perdo la connessione, **Then** il servizio e le operazioni accettate proseguono.
3. **Given** servizio attivo, **When** confermo Arresta o Riavvia vedendo archivio e conseguenze, **Then** seguo la transizione fino a un esito verificato; un timeout non viene presentato come arresto riuscito.
4. **Given** esito incerto dopo perdita della risposta o crash UI, **When** torno nell'app, **Then** posso riconciliare l'operazione originale prima di un nuovo comando; non parte alcun retry con effetti automatico.

### User Story 3 - Gestire le registrazioni dei progetti (Priority: P2)

Come sviluppatore importo un repository esistente, verifico il checkout, modifico nome/base configurata e rimuovo la sola registrazione.

**Why this priority**: Espone le capacità già implementate senza introdurre un nuovo workflow di sviluppo.

**Independent Test**: Su repository temporanei, eseguire importazione, verifica, modifica e rimozione dalla UI; controllare tramite CLI il registro e tramite snapshot che i file dei repository siano preservati.

**Acceptance Scenarios**:

1. **Given** servizio attivo e repository locale scelto, **When** confermo l'importazione, **Then** ottengo la registrazione o una motivazione sicura; importare lo stesso repository conduce al progetto esistente senza cambiarne nome o base implicitamente.
2. **Given** checkout modificato, indisponibile o privo di commit, **When** richiedo Verifica, **Then** vedo osservazione e data effettive; uno stato negativo osservato non viene confuso con fallimento del salvataggio o progetto pronto al lavoro.
3. **Given** nome/base da modificare, **When** confermo il riepilogo, **Then** viene applicata soltanto la modifica approvata; base invariata, cancellata o impostata sono scelte distinte.
4. **Given** revisione cambiata da un altro client dopo apertura della conferma, **When** invio modifica o rimozione, **Then** il core respinge la precondizione obsoleta; la UI ricarica e richiede una nuova conferma senza sovrascrivere.
5. **Given** progetto selezionato, **When** confermo Rimuovi dal registro, **Then** scompare la registrazione e nessun file, branch o worktree viene eliminato; una successiva importazione ha nuova identità.
6. **Given** servizio non raggiungibile oppure invio già in corso, **When** uso un'azione di modifica, **Then** non viene accodata una scrittura differita; posso consultare lo stato e riconciliare l'invio originale.

### User Story 4 - Osservare attività e diagnosticare errori (Priority: P2)

Come sviluppatore consulto diagnostica ed eventi recenti, seguo le nuove attività e riconosco perdita di continuità e problemi di connessione.

**Why this priority**: Serve a capire gli esiti reali senza mascherare errori o richiedere accesso ai dati interni.

**Independent Test**: Generare operazioni via CLI mentre la UI è collegata; interrompere e ripristinare servizio/connessione, simulare consumatore lento e storia scaduta.

**Acceptance Scenarios**:

1. **Given** eventi persistiti e servizio attivo, **When** apro Attività, **Then** vedo una storia limitata e posso seguire nuovi eventi correlati senza duplicarli nel passaggio a live.
2. **Given** connessione interrotta, **When** richiedo Riconnetti, **Then** riprendo dall'ultimo evento applicato; se la storia è scaduta o cambia archivio segnalo il gap e rileggo lo stato, senza inventare eventi mancanti.
3. **Given** molti eventi o consumatore lento, **When** i limiti vengono raggiunti, **Then** la UI resta utilizzabile, dichiara interruzione/troncamento e permette un recupero esplicito; non rallenta il daemon senza limite.
4. **Given** errore operativo, **When** apro diagnostica, **Then** vedo codice sicuro, azione suggerita e identificativo utile; nessun segreto o output grezzo viene esposto.

### Edge Cases

- Selezione annullata, percorso con spazi/caratteri speciali, repository omonimi, archivio cambiato con richieste ancora pendenti.
- Importazione duplicata, progetto rimosso da altro client, elenco invalidato fra pagine, osservazione relativa a una revisione precedente.
- Servizio bloccato in recovery, archivio non inizializzato, credenziali mancanti, versione incompatibile, runtime locale non utilizzabile.
- Crash fra invio e risposta, finestra chiusa durante operazione, doppio clic, ID di richiesta riutilizzato con contenuto differente.
- Evento duplicato/fuori ordine, history gap, errore callback, stream saturo; nessuna avanzamento del cursore prima dell'applicazione.
- Contenuti del repository con testo ostile devono essere testo inerte, mai comandi o navigazioni eseguibili.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: La UI DEVE esporre soltanto le capacità disponibili in 001/002: progetti, lifecycle, stato, operazioni, diagnostica ed eventi. Non deve simulare agenti o attività future.
- **FR-002**: L'utente DEVE poter scegliere un archivio locale alla volta e conoscere quello attivo. Scelta e letture non creano, migrano o riparano dati; l'eventuale inizializzazione avviene solo attraverso Avvia esplicito del core.
- **FR-003**: Elenco e dettagli DEVONO essere paginabili, coerenti per archivio/revisione e distinguere caricamento, vuoto, dati disponibili, dati storici, errore e dato non verificato. Le risposte obsolete non devono aggiornare la vista corrente.
- **FR-004**: L'applicazione DEVE mostrare stato/liveness del servizio senza dedurre salute dalla sola presenza di un processo e consentire Avvia, Arresta e Riavvia espliciti. Apertura, chiusura e cambio archivio non avviano/arrestano il daemon.
- **FR-005**: Arresta e Riavvia DEVONO richiedere conferma con archivio e impatto. Ogni comando deve avere un'identità stabile prima dell'invio; richieste duplicate non duplicano effetti.
- **FR-006**: Le operazioni DEVONO distinguere accettazione, avanzamento, successo, fallimento, blocco e risultato sconosciuto. Il controllo dell'esito originale deve precedere qualsiasi retry con effetti; nessuna risottomissione automatica dopo reconnect o crash.
- **FR-007**: L'utente DEVE poter importare un repository scelto localmente e consultarne la registrazione, senza copiare, inizializzare o modificare il repository. I duplicati riusano l'identità registrata secondo il core.
- **FR-008**: Verifica DEVE essere un'azione esplicita che mostra disponibilità, data, revisione osservata e flag anche sconosciuti. Le normali letture non effettuano una verifica Git implicita.
- **FR-009**: L'utente DEVE poter aggiornare nome/base e rimuovere la registrazione con riepilogo e revisione approvata. Precondizioni cambiate invalidano la conferma; rimozione non elimina file. La UI non aggira i controlli autorevoli del core.
- **FR-010**: Le scritture DEVONO essere indisponibili quando il servizio è assente/non verificato; nessuna coda di modifiche offline. Le richieste già accettate restano riconciliabili anche dopo chiusura della UI.
- **FR-011**: La UI DEVE consultare diagnostica ed eventi persistiti, poi seguire lo stream tramite incrementi separatamente verificabili: storia, live, replay/reconnect, backpressure. Deve mantenere ordine, cursore applicato e segnalazione esplicita dei gap.
- **FR-012**: Stato, comandi ed eventi DEVONO attraversare i contratti locali del core. La UI non scrive direttamente nel suo archivio, non duplica regole Git/recovery e non assume proprietà del processo daemon.
- **FR-013**: Contenuti locali DEVONO restare inerti; comandi, percorsi e dati provenienti dalla vista devono essere validati al confine privilegiato. Segreti, credenziali e output grezzo non devono attraversare la vista o comparire nei log UI.
- **FR-014**: Le azioni primarie DEVONO essere eseguibili da tastiera, con focus visibile, etichette accessibili, errori associati ai campi e stato non affidato al solo colore. I moduli mantengono l'input correggibile dopo un errore sicuro.

### Non-functional Requirements

- **NFR-001**: Consultazione e controllo locale non richiedono rete, account o credenziali di provider. Nessuna telemetria, aggiornamento o risorsa remota è necessaria al funzionamento.
- **NFR-002**: Prima piattaforma qualificata: macOS arm64/APFS del core; nessun obbligo di pieno supporto multipiattaforma o distribuzione pubblica firmata in questa feature.
- **NFR-003**: Il piano DEVE fissare limiti numerici di memoria di vista, pagine, eventi, processi client, attese e output, con comportamento osservabile quando raggiunti. Nessuna crescita illimitata o coda offline.
- **NFR-004**: I percorsi critici DEVONO avere test automatici unitari, di contratto, integrazione locale e UI, con repository/archivi temporanei, senza servizi esterni; i test del core devono restare eseguibili senza UI.
- **NFR-005**: Ogni misura DEVE riportare ambiente, carico, numero di campioni e p95/massimo quando pertinenti. I target seguenti non sono misure già ottenute; i gate aperti 001/002 non vengono dichiarati superati da questa feature.

### Key Entities

- **Archivio selezionato**: ambito locale corrente e sua identità verificata, distinto dal percorso scelto e dalle richieste di una selezione precedente.
- **Vista progetto**: identità, configurazione/versione e osservazione datata; il core resta l'unica fonte autorevole.
- **Operazione utente**: azione, ambito, identificativo, riepilogo/precondizione approvata e stato/esito originale riconciliabile.
- **Vista attività**: finestra limitata di eventi ordinati, cursore applicato e stato di continuità/connessione.

### Constitutional Invariants & Required Tests *(mandatory)*

- **I–II**: Test integrazione locale senza rete, letture a servizio fermo senza mutazioni, chiusura/crash UI con daemon e lavoro accettato superstiti; core verificabile senza UI.
- **III**: Test di confine sulle sole capacità attuali; nessuna dipendenza o requisito di provider. Provider indisponibili non applicabile perché esclusi.
- **IV**: Test reali con repository dirty/conflitti preservati in import/verifica/update/remove e snapshot prima/dopo; non si eseguono merge, cleanup o operazioni worktree.
- **V**: Unitari e integrazione su doppio invio, crash, esito sconosciuto, risposta obsoleta e retry dopo riconciliazione; nessuna duplicazione di effetti o terminazione di processi estranei.
- **VI**: Contratto e integrazione su conferma mancante/obsoleta, revisione concorrente e permessi negati dal core; nessuna autorizzazione ampliata dalla UI. Pubblicazione e deployment esclusi.
- **VII**: Adapter del desktop sostituibili e fixture reali locali; prove pertinenti obbligatorie prima dell'incremento implementativo.
- **VIII**: Test di correlazione, redazione, eventi persistenti/live/replay/gap e consumatore lento, con limiti osservabili.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Su archivio con 100 progetti, 30 aperture a servizio attivo mostrano la prima pagina utilizzabile entro 2 s al p95; tutti i progetti sono raggiungibili senza omissioni/duplicati in una lettura stabile.
- **SC-002**: In 30 consultazioni per modalità, il dettaglio è utilizzabile entro 1 s al p95 con servizio attivo ed entro 2 s al p95 a servizio fermo; freschezza e dati sconosciuti sono corretti nel 100% dei casi campionati.
- **SC-003**: In 10 cicli avvio/chiusura/riapertura/arresto, il daemon sopravvive sempre alla chiusura UI; arresto esplicito termina o mostra blocco/incertezza entro 12 s, senza dichiarare falsi successi.
- **SC-004**: In 20 sequenze import/verifica/modifica/rimozione, registro e CLI concordano; snapshot repository invariati nel 100% dei casi, inclusi dirty/conflitti. Doppio invio, revisione obsoleta e risposta persa non causano effetti duplicati nei relativi test.
- **SC-005**: In una prova funzionale di almeno 10 operazioni CLI reali, gli eventi osservati nella UI mantengono ordine e identità, con p95 disponibilità locale→vista≤1s sul campione. Interruzione, gap e saturazione sono segnalati entro3s dal rilevamento; ACK mancanti/errati non avanzano il cursore e la vista mantiene i limiti dichiarati. La UI resta navigabile durante le operazioni. Benchmark su1000eventi e carichi prolungati rinviati oltre la prima UI.
- **SC-006**: Il 100% dei flussi primari è completabile da tastiera a finestra 1280×800, senza controlli essenziali irraggiungibili; test automatici e review manuale verificano focus/etichette/contrasto.
- **SC-007**: Test di confine non consentono accesso privilegiato arbitrario dalla vista, esposizione di segreti o scritture offline. Tutti i relativi tentativi vengono respinti e la chiusura UI non termina processi non posseduti.

## Assumptions

- Questa è la milestone successiva alle prime due feature headless, richiesta esplicitamente dall'utente; non modifica la prima milestone Foundation né i principi della Constitution.
- Prima UI desktop locale per singolo utente, un archivio attivo e una finestra principale. La lingua iniziale è italiana. Nessuna compatibilità con il vecchio Maestro.
- È accettabile un'app avviabile dal checkout di sviluppo con runtime locale supportato; installer, firma/notarizzazione, auto-update, accesso remoto e piattaforme aggiuntive sono esclusi.
- Fuori scope: provider AI, Agent Runtime, Discovery, feature workflow prodotto, profili/skill/tool di agenti, terminale agenti, gestione worktree, pnpm/dipendenze dei progetti, review/merge/release. Il registro esistente non implica che un progetto sia pronto per una sessione.
- Il merge locale autorizzato di 001/002 non chiude 001/T082, 001/T085 e 002/T093; la readiness del core resta quella documentata nei report esistenti.

## Adeguamento dello scope — 2026-11-15

Su richiesta esplicita dell’utente: qualifica eventi limitata a stato/operazioni reali, ordine, recovery e limiti. Il brief richiede eventi osservabili, non100eventi/s per10min. Rinviate le campagne di volume/durata; nessuna promessa di throughput o di stabilità prolungata. E1–E4 restano incrementi verificabili con test funzionali bounded.
