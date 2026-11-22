# Feature Specification: Core Foundation & Background Daemon

**Feature Branch**: `001-core-background-daemon`
**Created**: 2026-11-08
**Status**: Approvata concettualmente — precisazioni integrate per review, non autorizza l'implementazione
**Input**: Servizio locale persistente, indipendente dalla UI, avviabile, interrogabile,
arrestabile e riavviabile tramite CLI minimale; stato coerente dopo un crash.
**Riferimenti**: [Constitution v1.0.0](../../.specify/memory/constitution.md),
[Product brief](../../docs/product-brief.md).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Avviare e conoscere lo stato del servizio (Priority: P1)

Come utente voglio avviare Maestro e sapere se è pronto, senza tenere aperto un terminale
o una UI, per disporre di un servizio locale affidabile.

**Why this priority**: È il primo incremento utilizzabile e rende verificabile l'autonomia del daemon.

**Independent Test**: Da un ambiente locale nuovo e senza rete, avviare il servizio,
verificare che il processo CLI di avvio termini, chiudere il terminale iniziale e
interrogare la stessa istanza da un secondo terminale.

**Acceptance Scenarios**:

1. **US1-A1 — Given** nessuno stato precedente, **When** richiedo l'avvio,
   **Then** viene creato lo stato iniziale e ottengo conferma di disponibilità solo quando
   il servizio è pronto; una successiva interrogazione identifica la stessa istanza.
2. **US1-A2 — Given** il servizio operativo, **When** il processo CLI che lo ha avviato
   termina, chiudo il terminale iniziale e disconnetto tutti i client,
   **Then** la stessa istanza del daemon continua autonomamente e un nuovo client ne legge
   lo stato. La terminazione del processo CLI, anche anomala, non equivale a un arresto richiesto.
3. **US1-A3 — Given** il servizio arrestato oppure già operativo, **When** arrivano dieci
   richieste simultanee di avvio, **Then** esiste al massimo un'istanza proprietaria dello
   stato; ogni richiesta indica avvio completato, già attivo o avvio in corso.
4. **US1-A4 — Given** il servizio assente, non raggiungibile oppure ancora in avvio,
   **When** interrogo lo stato, **Then** distinguo tali condizioni, senza avviarlo
   implicitamente né ricevere una falsa conferma di operatività.
5. **US1-A5 — Given** due archivi locali distinti, **When** avvio e arresto il servizio
   relativo a uno dei due, **Then** stato, eventi e lifecycle dell'altro restano indipendenti.

### User Story 2 - Arrestare e riavviare senza effetti collaterali (Priority: P1)

Come utente voglio arrestare o riavviare Maestro consapevolmente, preservando lo stato
e lasciando intatti processi e file estranei.

**Why this priority**: Il controllo esplicito del lifecycle evita perdita di dati e istanze concorrenti.

**Independent Test**: Eseguire cicli di avvio, arresto e riavvio; usare processi locali di prova
per verificare rilascio delle risorse e protezione dei processi estranei.

**Acceptance Scenarios**:

1. **US2-A1 — Given** il servizio operativo, **When** richiedo l'arresto,
   **Then** non accetta nuovi lavori mutanti, conclude o registra come interrotte le
   operazioni in corso, salva gli esiti e rilascia le risorse di propria competenza.
   Conferma l'arresto soltanto dopo la cessazione dell'istanza e dei processi gestiti previsti.
2. **US2-A2 — Given** il servizio già arrestato, **When** richiedo nuovamente l'arresto,
   **Then** ricevo un esito positivo «già arrestato» senza effetti aggiuntivi.
3. **US2-A3 — Given** il servizio operativo, **When** richiedo il riavvio,
   **Then** la nuova istanza diventa operativa solo dopo la conclusione sicura della
   precedente; cambia l'identità dell'istanza e resta disponibile lo stato confermato.
   Se il servizio è già arrestato, il riavvio equivale a un avvio.
4. **US2-A4 — Given** un processo gestito che non termina entro la scadenza,
   **When** arresto o riavvio il servizio, **Then** ricevo un esito bloccato con la risorsa
   coinvolta; non viene avviata un'altra istanza e non avviene una terminazione forzata implicita.
5. **US2-A5 — Given** un arresto o riavvio già in corso, **When** un client ripete la stessa
   richiesta o ne invia una incompatibile, **Then** ritrova l'operazione esistente oppure
   riceve «operazione in corso», senza esecuzioni concorrenti del lifecycle.

### User Story 3 - Ripartire dopo un crash con stato attendibile (Priority: P1)

Come utente voglio riavviare Maestro dopo un'interruzione anomala e capire quali operazioni
sono concluse, interrotte o richiedono intervento, senza duplicazioni o perdita di stato confermato.

**Why this priority**: La persistenza è utile solo se il riavvio riconcilia lo stato con la realtà.

**Independent Test**: Interrompere forzatamente il daemon in punti controllati di un'operazione,
riavviarlo e confrontare stato confermato, effetti locali e processi ancora presenti.

**Acceptance Scenarios**:

1. **US3-A1 — Given** operazioni già confermate e una in corso, **When** il daemon termina
   in modo anomalo e ne richiedo l'avvio, **Then** attraversa il recupero, conserva ogni
   esito confermato e assegna all'operazione interrotta un esito verificato o uno stato bloccato.
2. **US3-A2 — Given** un effetto locale avvenuto prima del crash ma senza risposta al client,
   **When** ripeto la richiesta identificata come la stessa operazione, **Then** il servizio
   verifica l'effetto precedente e non lo esegue una seconda volta alla cieca.
3. **US3-A3 — Given** risorse residue o processi sopravvissuti,
   **When** avviene il recupero, **Then** vengono riconciliati solo quelli di proprietà
   verificata; un identificativo di processo riutilizzato da un processo estraneo non ne
   autorizza la terminazione. Un dubbio sulla proprietà blocca la risorsa e viene segnalato.
4. **US3-A4 — Given** stato illeggibile, incompatibile, non scrivibile o spazio esaurito,
   **When** avvio il servizio o tento una modifica,
   **Then** non ottengo conferma di disponibilità alla scrittura o di successo della modifica;
   i dati restano preservati e la diagnostica indica causa e azione successiva.
5. **US3-A5 — Given** il crash durante un precedente recupero,
   **When** avvio nuovamente Maestro, **Then** la riconciliazione resta ripetibile,
   senza nuove duplicazioni né cancellazione automatica dei dati problematici.

### User Story 4 - Diagnosticare e osservare da client locali (Priority: P2)

Come utente o autore di un futuro client locale voglio leggere stato, errori ed eventi,
per capire cosa sta facendo Maestro senza dipendere da una UI.

**Why this priority**: Rende verificabili le operazioni e consente client futuri con gli stessi comportamenti.

**Independent Test**: Collegare due client locali, osservare un ciclo di lifecycle,
disconnettere e riconnettere un osservatore, simulare un client lento e richieste non autorizzate.

**Acceptance Scenarios**:

1. **US4-A1 — Given** due client autorizzati, **When** uno modifica il lifecycle,
   **Then** entrambi possono conoscere stato ed esito coerenti e correlare gli eventi
   all'istanza e all'operazione; ciascuno distingue un dato corrente dall'ultimo dato noto.
2. **US4-A2 — Given** un osservatore disconnesso, **When** torna con l'ultimo riferimento
   ricevuto, **Then** recupera gli eventi ancora conservati oppure riceve un'indicazione
   esplicita di lacuna e può riallinearsi allo stato corrente.
3. **US4-A3 — Given** un client lento o non compatibile, **When** continua a osservare o
   invia una richiesta non supportata, **Then** non blocca il servizio né gli altri client;
   riceve una disconnessione motivata o un errore comprensibile senza mutazioni.
4. **US4-A4 — Given** un utente locale diverso dal proprietario o un accesso da un'altra
   macchina, **When** tenta controllo o lettura, **Then** non ottiene accesso.
   Una richiesta autorizzata di diagnostica non modifica lo stato.
5. **US4-A5 — Given** un errore o una scadenza di attesa del client,
   **When** consulto la diagnostica, **Then** posso distinguere fallimento, esito ancora
   sconosciuto e operazione in corso, con identificativo e indicazione di cosa fare.
   Le informazioni diagnostiche non espongono segreti.

### Edge Cases

- Un processo esiste ma non risponde: «non raggiungibile» non equivale a «arrestato»;
  un nuovo avvio non può acquisire lo stesso stato senza verificare la cessazione del proprietario.
- Un residuo di una vecchia istanza o una risorsa di comunicazione occupata da altri non
  autorizzano cancellazioni o terminazioni indiscriminate.
- La risposta si perde dopo una modifica: la richiesta resta rintracciabile e la sua
  ripetizione non produce un'altra operazione.
- Il client si disconnette durante un arresto: l'operazione accettata continua nel core.
- Il disco si riempie durante la registrazione di un errore: la diagnostica ancora
  disponibile dichiara l'impossibilità di persistere; non promette un evento durevole.
- Eventi scaduti, output eccessivo o osservatori lenti producono limiti e lacune espliciti.
- Dopo sospensione della macchina o variazione dell'orologio, il servizio verifica di nuovo
  la disponibilità; l'ordine degli eventi non dipende soltanto dall'ora civile.
- Il recupero trova un esito non dimostrabile: richiede intervento e non dichiara il
  successo per deduzione dal solo stato precedente.

## Requirements *(mandatory)*

### Scope

La feature comprende controllo del daemon, stato del servizio e delle sue operazioni,
risorse possedute, comunicazione locale, eventi e diagnostica. Un «processo gestito» è un
eventuale processo ausiliario della Foundation; i test possono usare processi innocui di prova.
Le regole di arresto dei figli dopo un crash riguardano esclusivamente questi processi.
Non costituiscono una policy obbligatoria per il futuro Agent Runtime, che resta fuori scope.
Non viene introdotto un comando utente per eseguire programmi arbitrari.

Sono esclusi provider AI concreti, sessioni AI e scheduling di feature, Git Worktrees e
operazioni Git, installazione di dipendenze o pnpm, Electron, discovery di progetti, merge,
release, deployment, controllo remoto e migrazione dal precedente Maestro.
Non sono richiesti auto-avvio al login, supervisione del sistema operativo o riavvio
automatico dopo un crash: il recupero avviene al successivo avvio esplicito.

### Functional Requirements

- **FR-001**: Il servizio DEVE operare localmente senza UI, client aperti, rete o account esterni.
  Il daemon DEVE avere un lifecycle indipendente dal processo CLI che lo avvia: dopo
  l'avvio riuscito, l'uscita o la terminazione anomala della CLI, la chiusura del terminale
  e la disconnessione dei client NON DEVONO arrestarlo né modificarne l'identità.
- **FR-002**: Per ogni coppia utente/archivio di stato DEVE esistere al massimo un daemon
  proprietario attivo, anche con avvii simultanei. Archivi distinti DEVONO restare isolati.
- **FR-003**: La CLI DEVE consentire avvio, stato, arresto, riavvio, diagnostica e osservazione
  degli eventi, con aiuto locale, output leggibile e una rappresentazione strutturata degli
  stessi esiti. Successo, operazione in corso ed errore DEVONO essere distinguibili anche
  nell'uso non interattivo; la sintassi esatta resta al piano.
- **FR-004**: L'avvio DEVE confermare disponibilità solo quando stato locale, proprietà
  esclusiva e comunicazione sono pronti e l'eventuale recupero è concluso.
  Una lettura di stato NON DEVE avviare il servizio.
- **FR-005**: Lo stato DEVE mostrare identità dell'istanza, lifecycle, disponibilità,
  operazione in corso, ultimo errore rilevante ed eventuale intervento richiesto;
  i dati non verificati dal vivo DEVONO essere marcati come ultimo stato noto.
- **FR-006**: Il core DEVE applicare il lifecycle definito sotto, rifiutando transizioni
  incompatibili e rendendo osservabili accettazione, conclusione e fallimento delle richieste.
- **FR-007**: L'arresto DEVE impedire nuovi lavori mutanti, salvare gli esiti, registrare
  le interruzioni e rilasciare soltanto risorse proprie. Le letture restano disponibili
  finché il servizio può rispondere; un arresto già concluso è ripetibile senza effetti.
- **FR-008**: Il riavvio DEVE attendere l'arresto sicuro prima di creare una nuova istanza;
  un arresto incompleto blocca il riavvio. Da servizio arrestato equivale a un avvio.
- **FR-009**: Ogni richiesta mutante accettata DEVE essere rintracciabile con identità,
  ambito, intenzione ed esito. Ripetere la stessa richiesta, anche dopo una disconnessione
  o un crash, DEVE restituire o completare l'operazione originaria senza duplicarla.
- **FR-010**: Stato logico, esiti confermati, operazioni incomplete e informazioni necessarie
  al recupero DEVONO sopravvivere alla terminazione anomala del processo. La conferma di
  successo di una modifica DEVE seguire la sua registrazione durevole.
- **FR-011**: Prima di tornare operativo dopo un'interruzione, il servizio DEVE riconciliare
  stato salvato, processi e risorse reali. Per ogni operazione incompleta DEVE verificare
  l'esito, riprendere solo se sicuro oppure registrare interruzione o blocco con motivazione.
- **FR-012**: Il servizio DEVE distinguere processi e risorse propri da quelli estranei,
  verificando l'identità effettiva oltre al solo numero di processo. NON DEVE terminare,
  adottare o cancellare una risorsa di proprietà incerta.
- **FR-013**: I soli processi ausiliari della Foundation, di proprietà verificata e ancora
  vivi dopo il crash, DEVONO essere arrestati in modo controllato prima di tornare operativo.
  Se non è possibile, il recupero DEVE risultare bloccato. Questa feature non promette
  ripresa del loro lavoro. Il futuro Agent Runtime DEVE poter definire policy differenti
  senza ereditare obbligatoriamente questa terminazione; restano vincolanti verifica della
  proprietà, autorizzazione e prevenzione delle duplicazioni.
- **FR-014**: Errori di persistenza o stato incompatibile DEVONO impedire ulteriori mutazioni
  non registrabili, preservando i dati. NON DEVONO provocare reset, ricreazione vuota
  dell'archivio esistente o tentativi infiniti di avvio.
- **FR-015**: I futuri client locali DEVONO poter eseguire le stesse operazioni autorizzate
  e osservare lo stesso stato della CLI tramite un contratto documentato e identificabile
  per versione, senza modificare direttamente la persistenza. Richieste non valide o
  incompatibili DEVONO essere rifiutate senza effetti.
- **FR-016**: Solo il proprietario locale DEVE poter leggere o controllare il servizio.
  Il core DEVE verificare l'autorizzazione; provenire dalla stessa macchina non basta.
- **FR-017**: Avvio, arresto e riavvio esplicitamente richiesti dal proprietario autorizzano
  solo la relativa operazione. Diagnostica e sottoscrizione agli eventi NON DEVONO concedere
  permessi di mutazione. Questa feature NON DEVE offrire reset distruttivi o terminazioni
  forzate automatiche; un intervento manuale richiesto deve indicarne risorsa e conseguenze.
- **FR-018**: Il core DEVE emettere eventi strutturati per transizioni, esiti delle operazioni,
  errori, recupero e rifiuti di autorizzazione, con identità, ordine, istante e correlazione
  all'istanza e all'operazione dove applicabile. Gli eventi registrati prima di un crash
  DEVONO restare consultabili entro i limiti di conservazione.
- **FR-019**: Un osservatore DEVE poter ripartire dall'ultimo evento ricevuto; eventi ripetuti
  DEVONO mantenere identità riconoscibile. Eventi non più disponibili DEVONO essere segnalati
  come lacuna, con possibilità di rileggere lo stato corrente.
- **FR-020**: Diagnostica ed errori DEVONO indicare categoria, causa nota, operazione coinvolta,
  possibilità di ritentare e azione suggerita. Una scadenza del client NON DEVE essere
  presentata come prova che l'operazione sia fallita né annullarla implicitamente.
  Ogni comando di controllo DEVE terminare l'attesa entro 30 secondi, salvo i limiti più
  brevi dichiarati nei criteri; l'osservazione continua degli eventi è esclusa da tale limite.
- **FR-021**: Il servizio DEVE limitare conservazione diagnostica e accumulo per client lento,
  esplicitando scarti o disconnessioni. NON DEVE eliminare informazioni di stato necessarie
  al recupero per rispettare il limite dei log.
- **FR-022**: Se non può avviarsi o persistere la diagnostica, il comando DEVE comunque
  restituire l'errore disponibile, distinguendo le informazioni non salvate; nessun requisito
  impone di interrogare un daemon inesistente per capire il fallimento dell'avvio.

### Lifecycle e significato dello stato

Gli stati descrivono l'ultima condizione verificata del servizio. La presenza del processo
e la raggiungibilità sono osservazioni separate: un archivio che riporta «operativo»
non dimostra che l'istanza sia ancora viva.

| Stato | Significato e operazioni consentite | Uscite consentite |
|--------|------------------------------------|------------------|
| Arrestato | Nessuna istanza proprietaria viva verificata; sono disponibili avvio e diagnostica locale. | In avvio |
| In avvio | Acquisizione delle risorse e verifica dello stato; nessuna conferma di operatività. | In recupero, Operativo, In arresto, Bloccato |
| In recupero | Riconciliazione in corso; letture e richiesta di arresto consentite. | Operativo, In arresto, Bloccato |
| Operativo | Controllo e osservazione disponibili, persistenza utilizzabile. | In arresto, Bloccato |
| In arresto | Drenaggio e rilascio; nuove mutazioni rifiutate, letture finché disponibili. | Arrestato, Bloccato |
| Bloccato | Operazione fallita o sicurezza non verificabile; diagnostica disponibile dove possibile. | In recupero, In arresto, In avvio |

Da «Bloccato», un tentativo esplicito dopo la rimozione della causa avvia il recupero se
l'istanza è viva, oppure l'avvio se ne è verificata l'assenza. Un arresto può essere ritentato.
Un crash può interrompere qualsiasi stato senza salvarne un altro: alla successiva osservazione
il servizio è assente o non raggiungibile, con ultimo stato noto; il nuovo avvio passa dal recupero.
Nessuna transizione autorizza la creazione di due proprietari attivi.

Le operazioni distinguono «in corso», «riuscita», «interrotta», «fallita» e
«bloccata in attesa di intervento». «Esito sconosciuto» descrive ciò che un client non ha
ancora verificato, non equivale a successo o fallimento. Durante la perdita di accesso alla
persistenza, una nuova condizione osservata è dichiarata non salvata.

### Non-Functional Requirements

- **NFR-001 — Durabilità**: zero perdita di stato già confermato nei crash del processo
  coperti da SC-004; stato incompleto sempre rilevabile. Guasto fisico del disco e ripristino
  da backup sono fuori scope.
- **NFR-002 — Reattività**: rispettare i tempi di SC-001, SC-002, SC-005 e SC-007
  nel carico di riferimento, includendo esiti bloccati entro le rispettive scadenze.
- **NFR-003 — Isolamento e privacy**: nessuna connessione esterna necessaria; nessun accesso
  da altri utenti o macchine. Segreti, credenziali e contenuti integrali delle variabili
  d'ambiente NON DEVONO essere inclusi in eventi o diagnostica.
- **NFR-004 — Risorse limitate**: a riposo, senza figli, memoria residente del daemon
  non superiore a 150 MiB e CPU media non superiore all'1% di un singolo core su dieci minuti.
  Log ed eventi storici conservati hanno un limite predefinito complessivo di 50 MiB;
  la rotazione può richiedere al massimo altri 5 MiB temporanei. Al superamento si eliminano
  prima i dati diagnostici più vecchi, segnalando eventuali lacune. L'accumulo di eventi
  in attesa di consegna NON DEVE superare 1 MiB per osservatore; al limite si interrompe
  l'osservazione del client lento con motivo e possibilità di riallineamento.
- **NFR-005 — Compatibilità dei client**: i significati di stati, esiti ed errori DEVONO essere
  documentati indipendentemente dalla CLI; una versione non supportata deve essere
  riconoscibile prima di eseguire una mutazione.
- **NFR-006 — Verificabilità**: tutte le prove di accettazione DEVONO essere eseguibili
  localmente, con risorse temporanee, senza provider, UI o credenziali esterne. Tempi e
  interruzioni devono poter essere controllati nei test.

### Architectural Requirements

- **AR-001 — Confini del sistema operativo**: le funzionalità specifiche del sistema
  operativo per lifecycle del daemon, verifica della proprietà dei processi, comunicazione
  locale (IPC) e locking DEVONO essere isolate dietro interfacce dedicate e sostituibili.
  Le regole di lifecycle, autorizzazione e recovery NON DEVONO dipendere direttamente
  dalle primitive di una piattaforma. Il piano DEVE identificare questi confini e la
  piattaforma iniziale; non è richiesto supporto multipiattaforma completo nella prima
  milestone. La verifica comprende review delle dipendenze e test dei contratti con
  sostituti controllabili, oltre alle prove reali sulla piattaforma scelta.
- **AR-002 — Ambito della policy di recovery dei figli**: il piano DEVE separare la policy
  di FR-013 dai meccanismi comuni di identificazione e gestione sicura dei processi.
  La review DEVE verificare che l'arresto dei figli sia una decisione della Foundation
  e non una regola universale imposta al futuro Agent Runtime. Non è richiesto implementare
  ora tale runtime né un framework generale di policy.
- **AR-003 — Incrementi verificabili per gli eventi**: eventi persistenti, streaming,
  replay e backpressure restano requisiti della feature. Il piano DEVE suddividerne
  l'introduzione in incrementi verificabili, esplicitando per ciascuno capacità osservabili,
  dipendenze e prove di accettazione, senza un unico blocco monolitico. La scomposizione
  DEVE rendere verificabili persistenza e consultazione, consegna in streaming,
  recupero dopo riconnessione e gestione degli osservatori lenti. I limiti di sicurezza
  e di risorse si applicano fin dal primo incremento che espone la capacità interessata;
  la feature è completa soltanto quando tutte le capacità e i relativi criteri sono soddisfatti.

### Key Entities *(include if feature involves data)*

- **Archivio locale del servizio**: ambito di stato di un proprietario; conserva identità
  logica stabile, versione dei dati e informazioni necessarie alla ripartenza.
- **Istanza del daemon**: singola esecuzione con identità distinta, lifecycle osservato,
  disponibilità e riferimenti alle risorse possedute.
- **Operazione di controllo**: richiesta identificabile, autore autorizzato, ambito,
  intenzione, stato, esito ed eventuale intervento richiesto.
- **Risorsa gestita**: processo ausiliario o risorsa locale con proprietà verificabile,
  condizione osservata e responsabilità di rilascio.
- **Evento diagnostico**: fatto ordinato e correlabile a istanza/operazione, conservato
  entro i limiti dichiarati e distinguibile da un duplicato.
- **Osservatore locale**: client autorizzato, compatibilità dichiarata e posizione di lettura;
  la sua presenza non determina la vita del daemon.

### Constitutional Invariants & Required Tests *(mandatory)*

I test seguenti sono richiesti esplicitamente per la futura implementazione. La presente
fase verifica i documenti e non esegue test di un daemon ancora da costruire.

| Principi | Invariante e scenari | Test automatici richiesti |
|----------|---------------------|--------------------------|
| I, II | Servizio locale autonomo dal processo CLI; chiusura terminale/client senza arresto e archivi indipendenti (US1-A1–A5). | Integrazione locale senza rete, con uscita normale e terminazione anomala della CLI di avvio, chiusura del terminale, disconnessione di tutti i client e due archivi distinti; verifica dell'identità invariata del daemon e contratto di stato CLI/client. |
| III | Stato e diagnostica privi di dipendenze da provider. | Verifica del contratto e avvio in ambiente senza provider installati. |
| V | Unicità, persistenza, recupero ripetibile, nessuna duplicazione (US1-A3, US2-A3–A5, US3-A1–A5). | Unitari su transizioni e retry con tempo controllato; integrazione con crash prima/dopo effetto e salvataggio, concorrenza e guasti di persistenza. |
| V, VI | Solo risorse proprie; policy di arresto post-crash limitata agli ausiliari della Foundation; nessuna terminazione forzata implicita (US2-A1, US2-A4, US3-A3). | Integrazione con figli ausiliari innocui, orfani, figlio non cooperativo e processo estraneo; simulazione deterministica del riuso dell'identificativo di processo. |
| VI | Autorizzazione nel core e ambito limitato dell'azione (US4-A4). | Contratto con richieste non autorizzate, di sola lettura, incompatibili e fuori ambito; zero mutazioni. |
| VII | Prove ripetibili, indipendenti da servizi reali e da primitive OS dirette nella logica di dominio (AR-001). | Isolamento delle risorse di prova, test dei contratti OS con sostituti controllabili, controlli unitari con effetti sostituibili e integrazione con processi locali reali sulla piattaforma iniziale. |
| VIII | Diagnostica correlata, limiti, recupero eventi e segreti esclusi (US4-A1–A5). | Contratto di ordine/identità/lacune; integrazione con riconnessione, client lento, rotazione, disco pieno e valori segreti riconoscibili. |

**Non applicabilità motivata**: il principio IV resta vincolante ma non richiede test di merge,
worktree o conflitti perché questa feature non esegue operazioni Git. Del principio III non
si applicano ancora adapter, failover e checkpoint di lavoro AI. Del principio VI non si
applicano approvazioni di specifiche di progetto, merge o pubblicazione: nessuna di tali
operazioni è offerta. Non servono identificativi di progetto, sessione o run negli eventi
finché queste entità non esistono; restano obbligatorie le correlazioni di istanza/operazione.

## Success Criteria *(mandatory)*

### Measurable Outcomes

I limiti quantitativi di questa sezione e dei requisiti non funzionali sono obiettivi di
accettazione della futura implementazione, non prestazioni già misurate o garantite da
evidenze sperimentali. In questa fase non sono stati eseguiti benchmark e nessun obiettivo
è dichiarato raggiunto. Valori, carichi e soglie restano invariati.

Le misure future DEVONO usare il carico e l'ambiente dichiarati nelle assunzioni e riportare
separatamente obiettivo e risultato osservato, con versione provata, piattaforma, hardware,
carico, numero di campioni ed esito rispetto alla soglia. Uno scostamento DEVE essere
segnalato, senza sostituire implicitamente l'obiettivo con il valore misurato.

- **SC-001**: In almeno il 95% di 30 cicli ordinari, l'utente ottiene conferma di servizio
  operativo entro 5 secondi dall'avvio, di arresto entro 10 secondi e di riavvio entro 15 secondi.
  Un arresto non completabile entro 10 secondi restituisce un blocco motivato, senza falso successo.
- **SC-002**: Con dieci client simultanei e 1.000 interrogazioni complessive, almeno il 95%
  delle richieste di stato riceve risposta entro 500 ms; ogni richiesta termina entro
  2 secondi con stato oppure errore/esito sconosciuto esplicito.
- **SC-003**: In 100 prove da dieci richieste simultanee di avvio, zero istanze proprietarie
  duplicate; in 100 ripetizioni della stessa operazione, zero effetti duplicati.
- **SC-004**: In almeno 30 prove di crash distribuite tra avvio, modifica, arresto e recupero,
  zero perdite di esiti confermati e zero effetti ripetuti alla cieca. Ogni operazione
  incompleta torna a un esito verificato o a un blocco motivato.
- **SC-005**: Con 1.000 operazioni registrate e fino a dieci risorse gestite da riconciliare,
  ogni avvio dopo crash rende disponibile entro 30 secondi il servizio operativo oppure
  una diagnosi di blocco con causa e azione successiva.
- **SC-006**: In tutte le prove con processi estranei, risorse di proprietà incerta e
  accessi non autorizzati, zero terminazioni, cancellazioni, letture protette o mutazioni
  indebite. Per ogni arresto riuscito, zero processi gestiti residui.
- **SC-007**: Con dieci osservatori e 100 eventi al secondo per 60 secondi, almeno il 95%
  degli eventi raggiunge gli osservatori che leggono regolarmente entro 1 secondo.
  Un osservatore fermo non fa fallire SC-002; dopo riconnessione si recuperano gli eventi
  conservati o viene dichiarata la lacuna, senza omissioni silenziose.
- **SC-008**: Tutti i percorsi di controllo e recovery passano senza rete né UI.
  Dopo l'uscita normale o la terminazione anomala della CLI di avvio, la chiusura del
  terminale iniziale e la disconnessione di tutti i client, la stessa istanza del daemon
  resta operativa per almeno dieci minuti ed è nuovamente interrogabile.
- **SC-009**: In una prova a riposo e una di saturazione diagnostica sono rispettati i
  limiti di NFR-004; in tutti gli eventi e report delle prove con segreti riconoscibili
  compaiono zero valori segreti.
- **SC-010**: Per ogni categoria di errore prevista, il risultato consente di distinguere
  azione riuscita, in corso, fallita, bloccata o non verificata e indica il passo successivo.
  Tutti i comandi di controllo terminano l'attesa entro 30 secondi, senza annullare
  implicitamente l'operazione. Tutte le operazioni CLI hanno aiuto locale e risultati
  leggibili e strutturati concordanti.

| Copertura requisiti | Scenari principali | Criteri di accettazione |
|---------------------|--------------------|------------------------|
| FR-001–FR-005 | US1-A1–A5 | SC-001–SC-003, SC-008, SC-010 |
| FR-006–FR-008 | US2-A1–A5 | SC-001, SC-003, SC-006 |
| FR-009–FR-011 | US3-A1–A2, US3-A5 | SC-003–SC-005 |
| FR-012–FR-014 | US2-A4, US3-A3–A4 | SC-005–SC-006, SC-010 |
| FR-015–FR-017 | US4-A1, US4-A3–A4 | SC-006, SC-010 |
| FR-018–FR-019 | US4-A1–A2 | SC-007, SC-009 |
| FR-020–FR-022 | US3-A4, US4-A3–A5 | SC-002, SC-009–SC-010 |
| NFR-001–NFR-006 | Tutte le storie e test costituzionali pertinenti | SC-001–SC-010 |
| AR-001 | Confini OS e test costituzionali del principio VII | Review delle dipendenze, test dei contratti sostituibili e prove sulla piattaforma iniziale |
| AR-002 | Ambito Foundation di FR-013 e US3-A3 | Review della separazione tra policy di recovery e meccanismi comuni |
| AR-003 | US4-A1–A3 | Review degli incrementi e delle relative prove; SC-007 e SC-009 per il risultato completo |

## Assumptions

- **Ambito utente**: uso personale locale; un daemon per utente e archivio. Un utente con
  privilegi amministrativi sulla macchina è fuori dal confine di protezione.
- **Restart**: avvio richiesto dall'utente; nessun supervisore di riavvio automatico richiesto.
  Il recupero automatico all'avvio non autorizza azioni distruttive.
- **Processi**: questa foundation governa solo risorse ausiliarie proprie. I processi di
  prova servono a dimostrare i comportamenti senza introdurre esecuzione di agenti o shell arbitrarie.
  Il futuro Agent Runtime potrà adottare recovery policy differenti nel rispetto della
  Constitution; la terminazione post-crash degli ausiliari non ne predetermina il comportamento.
- **Persistenza**: filesystem locale scrivibile e supporto del sistema operativo alla
  gestione dei processi e ai permessi tra utenti; nessuna dipendenza cloud.
- **Ambiente di misura**: macchina con almeno due core, 4 GiB di RAM e storage locale SSD,
  senza altro carico intenso. Il piano dichiarerà sistema operativo/versione della prima
  piattaforma supportata e configurazione di riferimento; non si promette parità
  multipiattaforma in questa specifica.
- **Carico ordinario**: fino a dieci client, 1.000 operazioni conservate e nessun processo
  ausiliario per i tempi ordinari; i carichi speciali di recovery ed eventi sono quelli
  esplicitati in SC-005 e SC-007. Nessun carico AI è incluso.
- **Conservazione**: i limiti diagnostici non si applicano allo stato autorevole. In questo
  incremento non è previsto un comando di eliminazione dello storico delle operazioni;
  un archivio non più scrivibile segue FR-014 anziché perdere dati silenziosamente.
- **Decisioni rinviate al piano**: persistenza concreta, trasporto locale, sintassi dei
  comandi, codici di uscita e formato dei messaggi. Restano vincolanti la Constitution
  e tutti i comportamenti qui definiti; nessuna scelta eredita compatibilità dal vecchio Maestro.
