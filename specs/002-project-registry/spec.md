# Feature Specification: Project Registry & Local Git Repositories

**Feature Branch**: `002-project-registry`  
**Created**: 2026-11-09  
**Status**: Draft — per review  
**Input**: Specificare la feature 2 di Maestro a partire da [product-brief.md](../../docs/product-brief.md), dopo Core Foundation & Background Daemon.

## Clarifications

### Session 2026-11-09

- Q: La registrazione richiede già almeno un commit e un branch di base valido? → A: No. Registrare repository locali validi anche senza commit o senza branch di base selezionato, mostrando esplicitamente i prerequisiti mancanti; le operazioni future verificheranno i propri prerequisiti prima dell'esecuzione.
- Q: Deve essere possibile importare un progetto da un worktree già esistente? → A: Sì. Importare dal checkout principale o da un worktree esistente, deduplicando per repository; creazione e gestione dei worktree restano fuori scope.

## User Scenarios & Testing *(mandatory)*

Il secondo incremento rende utilizzabile un registro locale di progetti Git: l'utente
registra un repository esistente, lo ritrova dopo un restart, ne verifica disponibilità
e configurazione e può rimuoverlo dal registro senza toccare i suoi file.
È il passo successivo alle primitive del daemon e precede Project Discovery ed esecuzione agenti.

### User Story 1 - Registrare un repository locale senza modificarlo (Priority: P1)

Come utente voglio aggiungere un repository esistente, assegnargli un nome leggibile
e conoscere il branch locale che verrà proposto per il lavoro futuro.

**Why this priority**: Il progetto è il contesto persistente per tutte le attività successive.

**Independent Test**: Registrare un repository temporaneo e interrogarlo da un secondo
client; verificare identità persistente e assenza di modifiche al repository.

**Acceptance Scenarios**:

1. **Given** un repository locale valido e il daemon operativo, **When** lo registro,
   **Then** ottengo un progetto con ID stabile, nome e posizione risolta; il branch di
   base è verificato se configurato, altrimenti è indicato come non configurato.
   Non vengono creati branch, file o commit nel repository.
2. **Given** lo stesso repository raggiunto da una sottocartella o da un percorso
   equivalente, **When** lo registro di nuovo, **Then** ricevo il progetto esistente,
   senza duplicati e senza modificarne nome o configurazione implicitamente.
3. **Given** due richieste simultanee sul medesimo repository, **When** vengono accettate,
   **Then** esiste un solo progetto attivo e i due esiti ne identificano lo stesso ID.
4. **Given** un percorso inesistente, non accessibile o non Git, **When** tento di
   registrarlo, **Then** ricevo causa e azione suggerita; non compare un progetto parziale.
5. **Given** modifiche locali, file non tracciati o conflitti, **When** registro il repository,
   **Then** il progetto può essere registrato se gli altri requisiti sono soddisfatti,
   l'osservazione segnala tali condizioni e tutti i contenuti e lo stato Git sono preservati.
6. **Given** un repository Git valido senza commit e senza branch di base configurato,
   **When** lo registro, **Then** ottengo una registrazione completa con gli stessi
   diritti di consultazione, rinomina, verifica e rimozione degli altri progetti;
   l'assenza di commit e di branch di base è esplicita, senza creazioni automatiche.
7. **Given** un worktree esistente e un repository non ancora registrato, **When** lo
   importo, **Then** ottengo un progetto con quel checkout come riferimento per le
   osservazioni. Importare in seguito il checkout principale o un altro worktree dello
   stesso repository restituisce lo stesso progetto senza cambiare il checkout di riferimento.

---

### User Story 2 - Ritrovare e verificare i progetti (Priority: P1)

Come utente voglio elencare e consultare i progetti anche senza client precedenti,
distinguendo le osservazioni salvate da una verifica corrente del repository.

**Why this priority**: Un elenco persistente è utile soltanto se non scambia dati storici
per disponibilità attuale.

**Independent Test**: Registrare più progetti, disconnettere i client, riavviare il daemon
e confrontare identità e configurazioni; rendere poi un percorso non disponibile.

**Acceptance Scenarios**:

1. **Given** progetti registrati, **When** chiudo tutti i client e riavvio il daemon,
   **Then** elenco e dettaglio conservano ID, nomi, posizioni e configurazioni confermate.
2. **Given** il daemon arrestato, **When** consulto elenco o dettaglio,
   **Then** ottengo l'ultimo registro confermato con indicazione storica, senza avviare
   processi persistenti, inizializzare archivi o cambiare lo stato salvato.
3. **Given** un repository spostato, eliminato o divenuto illeggibile, **When** richiedo
   una verifica esplicita, **Then** il progetto resta nel registro con disponibilità
   non confermata, causa e azione suggerita; nessun repository viene ricreato.
4. **Given** una verifica precedente riuscita, **When** leggo il progetto senza verificarlo,
   **Then** vedo data e natura storica dell'osservazione, senza una nuova ispezione implicita.
5. **Given** una sostituzione del repository o una sua identità incerta, **When** verifico,
   **Then** Maestro non associa automaticamente un repository differente al progetto;
   segnala l'incertezza e richiede una scelta esplicita.
6. **Given** un progetto importato da un worktree poi eliminato o spostato esternamente,
   **When** verifico, **Then** il progetto resta registrato e il checkout di riferimento
   risulta non disponibile. Non viene selezionato automaticamente un altro checkout
   e l'indisponibilità del percorso non viene presentata come prova della scomparsa dell'intero repository.

---

### User Story 3 - Configurare nome e branch locale di base (Priority: P2)

Come utente voglio cambiare nome e branch locale di base senza cambiare branch
nel mio checkout né avviare lavoro sul progetto.

**Why this priority**: La configurazione deve riflettere il repository dell'utente,
senza assumere nomi come main/master o una pubblicazione remota.

**Independent Test**: Cambiare configurazione su un progetto registrato, controllare
il checkout invariato e ripetere l'aggiornamento da due client con una revisione obsoleta.

**Acceptance Scenarios**:

1. **Given** un branch locale esistente, **When** lo imposto come base,
   **Then** la configurazione viene confermata e persistita; HEAD, index e file non cambiano.
2. **Given** un checkout con HEAD scollegato da un branch, **When** registro il progetto,
   **Then** la registrazione riesce anche senza selezionare un branch di base: il campo
   resta non configurato. Se indico un branch locale valido, viene salvato senza checkout.
   La mancanza di una scelta è distinta da un valore esplicitamente fornito ma non valido.
3. **Given** un branch inesistente o disponibile soltanto come riferimento remoto,
   **When** tento di configurarlo, **Then** la richiesta fallisce e la configurazione precedente resta valida.
4. **Given** due client sulla stessa revisione, **When** entrambi propongono modifiche diverse,
   **Then** una modifica può essere confermata; l'altra riceve conflitto e deve rileggere
   la revisione corrente, senza sovrascrittura silenziosa.
5. **Given** un branch di base eliminato esternamente dopo la configurazione,
   **When** verifico il progetto, **Then** l'impostazione viene conservata ma segnalata
   come non valida, senza sostituzione automatica con un altro branch.
6. **Given** un progetto registrato senza commit, **When** l'utente crea esternamente
   il primo commit e richiede una verifica, **Then** l'osservazione aggiorna la presenza
   dei commit conservando l'ID del progetto; un branch di base non configurato resta tale
   fino a una scelta esplicita, senza dichiarare il progetto automaticamente pronto o approvato.

---

### User Story 4 - Rimuovere soltanto la registrazione (Priority: P2)

Come utente voglio togliere un progetto dall'elenco senza cancellare codice,
modifiche locali o repository.

**Why this priority**: La gestione del registro deve avere un effetto chiaro e limitato.

**Independent Test**: Rimuovere esplicitamente un progetto dirty, ripetere la stessa
richiesta e verificare che il repository sia integralmente conservato.

**Acceptance Scenarios**:

1. **Given** un progetto identificato e la sua revisione corrente, **When** chiedo
   esplicitamente di rimuoverne la registrazione, **Then** scompare dall'elenco attivo,
   mentre file, branch, index, oggetti Git e modifiche locali restano invariati.
2. **Given** una rimozione confermata ma una risposta persa, **When** ripeto la stessa
   richiesta, **Then** ottengo lo stesso esito senza ulteriori effetti.
3. **Given** una revisione superata o un ID non corrispondente, **When** richiedo la
   rimozione, **Then** ricevo un errore esplicito senza rimuovere un altro progetto.
4. **Given** un repository rimosso dal registro, **When** lo registro nuovamente con
   una nuova richiesta, **Then** ottengo un nuovo progetto; un retry della vecchia
   rimozione non agisce sulla nuova registrazione.

### Edge Cases

- Percorsi con spazi, caratteri Unicode, alias e collegamenti simbolici: equivalenze
  vengono risolte prima della deduplicazione; link non risolvibili, accessi negati
  o identità non dimostrabili producono un errore, senza aggirare i permessi.
- Due cloni distinti con lo stesso remoto restano progetti distinti; nome e remoto
  non sono prove di identità. Repository annidati indipendenti restano distinguibili.
- Un percorso dentro un submodule identifica il repository del submodule, senza
  registrare ricorsivamente padre o altri submodule.
- Checkout principale e worktree collegati esistenti del medesimo repository producono
  un solo progetto. Il checkout della prima registrazione confermata diventa il riferimento
  per le osservazioni; import successivi non lo sostituiscono. Nessun worktree viene creato o gestito.
- Un percorso bare privo di checkout non è registrabile: errore motivato e nessuna
  conversione implicita. Il vincolo riguarda il percorso importato, non il formato del
  repository condiviso da un worktree esistente utilizzabile. Un checkout valido senza
  commit, con HEAD detached o privo di branch locali resta registrabile; assenza di commit,
  branch di base non configurato e branch configurato divenuto non valido sono condizioni distinte.
- Un nome di branch non ancora associato a un commit non costituisce un branch di base
  valido. Se il campo è omesso la registrazione può riuscire senza configurarlo; un
  branch esplicitamente indicato ma non valido viene rifiutato, senza ignorare l'input.
- Il repository o il branch cambiano durante una verifica: nessuna conclusione
  di validità su evidenze incoerenti; la richiesta termina con errore riprovabile.
- Repository corrotto, Git non disponibile o verifica oltre la deadline: disponibilità
  non verificata, diagnosi distinta da «percorso assente», nessuna riparazione automatica.
- Crash prima/dopo conferma, retry e disconnessione durante mutazioni: applicazione
  completa oppure assenza dell'effetto, esito interrogabile e nessun duplicato.
- Richiesta non autorizzata, ID riutilizzato con parametri differenti, approvazione
  riferita a una revisione precedente: nessun effetto sul registro o sul repository.
- Mancanza di spazio o persistenza non disponibile: nessun successo dichiarato
  senza salvataggio; elenco storico e diagnostica distinguono ciò che è confermato.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Il core DEVE permettere registrazione, elenco, dettaglio, verifica esplicita,
  modifica di nome/branch di base e rimozione della registrazione di progetti locali.
  Le operazioni DEVONO essere utilizzabili tramite CLI e contratti locali senza UI.
- **FR-002**: La registrazione DEVE verificare che il percorso identifichi un repository
  supportato e leggibile dall'utente corrente attraverso un checkout locale utilizzabile,
  principale oppure worktree collegato già esistente. L'assenza di commit o di un branch
  di base configurato NON DEVE impedirne la registrazione.
  L'ispezione Git necessaria alla registrazione NON DEVE essere confusa con Project
  Discovery: non è richiesta un'analisi funzionale o architetturale dei contenuti sorgenti.
- **FR-003**: Ogni progetto DEVE avere un ID stabile, indipendente da nome, branch corrente,
  checkout di accesso e remoto. La deduplicazione DEVE riconoscere il repository locale
  condiviso tra checkout principale e worktree collegati, oltre alle equivalenze dei percorsi.
  Nomi e URL remoti non costituiscono identità; cloni distinti restano progetti distinti.
- **FR-004**: Registrazioni equivalenti e concorrenti, anche da checkout differenti
  del medesimo repository, DEVONO restituire un solo progetto attivo. La prima registrazione
  confermata DEVE conservare il checkout scelto come riferimento per le osservazioni;
  import successivi NON DEVONO cambiare tale riferimento, nome o branch di base implicitamente.
- **FR-005**: Il nome DEVE essere modificabile, non vuoto dopo la rimozione degli spazi
  esterni, lungo al massimo 120 caratteri Unicode e privo di caratteri di controllo.
  Nomi uguali sono ammessi: selezioni e mutazioni DEVONO usare l'ID, non una corrispondenza ambigua.
- **FR-006**: Il branch di base DEVE essere facoltativo alla registrazione. Se indicato,
  DEVE essere un branch locale esistente associato a un commit; input non valido produce
  errore senza confermare la mutazione. Se omesso, si salva il branch locale attualmente
  selezionato soltanto se valido; altrimenti il campo resta non configurato e la registrazione
  riesce. Nessun fallback main/master, su remoti o su un nome di branch ancora senza commit.
- **FR-007**: Cambiare branch di base DEVE cambiare soltanto la configurazione Maestro.
  Il sistema DEVE ricontrollare esistenza e validità del branch prima della conferma,
  senza checkout, creazione di branch, fetch o modifica del repository.
- **FR-008**: Il dettaglio DEVE distinguere configurazione salvata e ultima osservazione:
  disponibilità del repository, presenza o assenza di commit, branch di base non
  configurato/valido/non valido/non verificato, branch corrente, HEAD detached o assenza
  di un primo commit, modifiche tracciate/non tracciate e conflitti, data ed eventuale errore.
  I prerequisiti Git mancanti DEVONO essere visibili senza rendere parziale la registrazione.
  Queste osservazioni NON DEVONO attestare approvazione o prontezza generale del progetto;
  ogni futura operazione dovrà verificare i propri prerequisiti prima dell'esecuzione.
  Le osservazioni di HEAD, file modificati e conflitti DEVONO identificare il checkout
  di riferimento osservato e NON DEVONO essere presentate come stato di tutti i worktree.
- **FR-009**: Elenco e dettaglio DEVONO restituire osservazioni datate, senza verifiche
  implicite, mutazioni del registro o scritture nel repository. A daemon assente DEVONO
  consultare lo stato confermato secondo i comportamenti read-only della Foundation.
- **FR-010**: La verifica esplicita DEVE aggiornare solo l'osservazione del progetto.
  Indisponibilità o invalidità NON DEVONO cancellare il progetto, cambiare configurazione,
  ricreare directory o associare automaticamente un repository diverso.
- **FR-011**: Il sistema DEVE distinguere un repository verificato da identità incerta
  o evidenze cambiate durante l'operazione. In assenza di prova coerente DEVE bloccare
  aggiornamenti dipendenti dal repository e indicare l'azione richiesta, preservando lo stato precedente.
- **FR-012**: Aggiornamenti di configurazione e rimozioni DEVONO identificare progetto
  e revisione approvata. Una configurazione cambiata da un altro client DEVE invalidare
  la modifica basata sulla vecchia revisione. Una verifica non cambia la revisione della configurazione.
- **FR-013**: Ogni mutazione DEVE avere un identificativo di richiesta e un esito
  durevole interrogabile. Un retry con identico intento DEVE restituire l'esito originale;
  lo stesso identificativo con intento diverso DEVE fallire senza effetti.
- **FR-014**: Registrazione, aggiornamento e rimozione DEVONO preservare l'atomicità
  dello stato logico dopo crash. Una conferma implica salvataggio completo; risposta persa
  o timeout NON DEVONO autorizzare il client a ripetere effetti con un nuovo intento alla cieca.
- **FR-015**: Disconnessione del client NON DEVE cancellare una mutazione già accettata
  né fermare il daemon. Le mutazioni richiedono il daemon disponibile e autorizzazione locale;
  nessun comando del registro avvia implicitamente il servizio o amplia i permessi.
- **FR-016**: La rimozione DEVE riguardare esclusivamente la registrazione identificata.
  NON DEVE cancellare o modificare directory, contenuti, branch, index, oggetti Git,
  configurazione Git, worktree o dati di altri progetti, anche se il repository è dirty.
- **FR-017**: Registrazione, ispezione e verifica NON DEVONO eseguire hook, script del
  progetto, installazioni, build, helper esterni configurati dal repository o azioni remote.
  Nessun contenuto del repository costituisce un'autorizzazione a eseguire comandi.
- **FR-018**: Il core DEVE applicare i controlli di autorizzazione e revisione per tutti
  i client. L'interfaccia DEVE descrivere causa, riprovabilità e prossima azione degli
  errori, distinguendo input non valido, accesso negato, repository non supportato,
  identità incerta, conflitto, timeout e persistenza indisponibile.
- **FR-019**: Le mutazioni confermate e gli esiti delle verifiche DEVONO essere osservabili
  con identificativi di progetto e richiesta, riusando le garanzie Foundation di eventi
  durevoli, replay, gap e backpressure. Gli errori di persistenza NON DEVONO apparire come eventi confermati.
- **FR-020**: Registrare un progetto NON DEVE avviare Project Discovery, analisi AI,
  sessioni, lavoro Git o creazione di feature, né dichiarare una specifica approvata.
  L'approvazione della Discovery resta un gate distinto delle funzionalità future.

### Non-Functional Requirements

- **NFR-001**: Tutte le funzioni DEVONO funzionare localmente, senza rete, account cloud,
  credenziali provider o UI; la futura UI userà le stesse regole del core.
- **NFR-002**: Le osservazioni DEVONO essere dichiarate valide al momento della verifica,
  non garantite per operazioni Git future: modifiche esterne richiederanno nuovi controlli.
- **NFR-003**: Verifiche e operazioni concorrenti DEVONO avere attese e consumo di risorse
  limitati; un repository lento o inaccessibile NON DEVE bloccare consultazione di altri
  progetti o controllo del daemon. Il piano definirà limiti e prove senza allargare quelli Foundation.
- **NFR-004**: Log, errori ed eventi NON DEVONO contenere contenuti sorgenti, diff, ambiente,
  credenziali o URL remoti completi. Percorsi locali sono dati del progetto visibili al
  client autorizzato, ma non vengono copiati automaticamente nei log diagnostici.
- **NFR-005**: L'ispezione DEVE preservare contenuti tracciati/non tracciati, index,
  riferimenti e configurazioni Git. Non deve acquisire lock persistenti che impediscano
  all'utente di lavorare nel repository o trattenere risorse dopo completamento/timeout.

### Key Entities *(include if feature involves data)*

- **Project**: Identità persistente della registrazione, nome, repository locale verificato,
  posizione risolta del checkout di riferimento, branch locale di base facoltativo,
  revisione della configurazione e date di creazione/aggiornamento. Più checkout dello
  stesso repository non generano più progetti; la registrazione è completa anche con prerequisiti Git mancanti.
- **Repository Observation**: Ultima verifica del repository e del branch di base, checkout
  di riferimento osservato e suo stato, disponibilità, presenza di commit, prerequisiti Git mancanti, momento
  e limiti dell'osservazione, causa di eventuale incertezza.
- **Project Operation**: Intento autorizzato di mutazione, progetto/revisione interessati,
  identificativo della richiesta ed esito necessario a retry e recovery; non implica un nuovo
  motore di operazioni separato dalla Foundation.

### Constitutional Invariants & Required Tests *(mandatory)*

La [Constitution 1.0.0](../../.specify/memory/constitution.md) è vincolante.

| Principi | Invariante applicato | Prove richieste e risultato sicuro |
|---|---|---|
| I, II | Registro locale nel core; client sostituibili | Contratti CLI/client locale e integrazione senza rete/UI: stessi ID e configurazioni; chiusura client senza perdita di lavoro accettato |
| III | Nessun requisito di provider per gestire progetti | Contratti eseguibili senza provider installati o credenziali; nessuna Discovery simulata come completata |
| IV | Ispezione e rimozione dal registro preservano Git e lavoro locale | Integrazione con repository reali senza commit, senza branch di base, dirty, conflitti, detached, submodule e worktree esistente: contenuti, index, ref e configurazioni invariati; hook/helper sentinella mai eseguiti |
| V | Conferme durevoli, retry e recovery senza duplicati | Unitari per esiti/transizioni; integrazione con crash prima/dopo conferma e retry concorrenti: un progetto e un esito coerente, nessuna ricreazione del repository |
| VI | Azione, progetto e revisione delimitano l'autorizzazione | Contratti con accesso negato, intenti differenti sullo stesso ID e revisioni obsolete: zero effetti; rimozione mai interpretata come cleanup del repository |
| VII | Dipendenze esterne sostituibili; safety provata anche su Git reale | Unitari per identità, normalizzazione, concorrenza e validazione; contratti per errori e client; integrazione locale con archivi temporanei e guasti controllati |
| VIII | Stato interrogabile ed eventi correlati e redatti | Contratti/integrazione per eventi dopo commit, replay/gap, osservazioni storiche e segreti sentinella; niente segreti o falso successo |

Gli scenari di accettazione delle quattro storie e gli edge case DEVONO diventare prove
unitarie, di contratto o di integrazione pertinenti nel piano e nei task successivi.
Provider indisponibili, processi agenti orfani, merge/pubblicazione e approvazione della
Discovery non sono scenari operativi di questa feature: nessuna di tali azioni viene eseguita.
Non si estende qui la policy di terminazione degli ausiliari Foundation all'Agent Runtime.

## Success Criteria *(mandatory)*

### Measurable Outcomes

Le soglie seguenti sono **target da verificare**, non prestazioni già misurate.

- **SC-001**: L'utente può registrare, consultare, rinominare, configurare e rimuovere un
  progetto da CLI senza UI o rete, completando tutti gli scenari delle quattro storie.
  Il 100% dei casi validi senza commit o senza branch di base si registra con prerequisiti
  mancanti espliciti; una successiva verifica dopo il primo commit conserva lo stesso ID.
- **SC-002**: Su 100 progetti registrati e 1.000 consultazioni da dieci client,
  almeno il 95% delle letture termina entro 500 ms; ogni lettura restituisce dato o
  errore esplicito entro 2 s. I campioni falliti/timeout restano nel report.
- **SC-003**: Su 30 registrazioni/verifiche di repository locali con fino a dieci branch
  e 100 commit, almeno il 95% termina entro 5 s; ogni tentativo termina con risultato
  o errore motivato entro 30 s. Repository lento/inaccessibile non compromette SC-002.
- **SC-004**: In 100 retry identici e 20 registrazioni concorrenti tramite percorsi
  equivalenti e checkout differenti dello stesso repository, si osservano un solo progetto
  attivo e zero aggiornamenti impliciti della configurazione o del checkout di riferimento.
- **SC-005**: In almeno 30 crash distribuiti fra registrazione, aggiornamento e rimozione,
  zero conferme perse, zero progetti parziali e zero duplicati dopo restart e retry.
- **SC-006**: In tutte le prove dirty, conflitti, input ostili, timeout e rimozione,
  zero modifiche a contenuti/index/ref/configurazioni del repository e zero hook,
  script o helper del progetto eseguiti; zero azioni remote.
- **SC-007**: In tutte le prove di revisione obsoleta, richiesta non autorizzata e ID
  riutilizzato con intento differente, zero effetti; causa e azione suggerita disponibili.
- **SC-008**: Dopo restart o indisponibilità del repository, il 100% delle registrazioni
  confermate conserva identità/configurazione; le osservazioni storiche o non verificabili
  sono distinguibili e nessuna lettura offline avvia implicitamente il servizio.
- **SC-009**: Eventi di tutte le mutazioni confermate risultano correlabili al progetto
  e alla richiesta oppure viene dichiarata la degradazione di osservabilità secondo
  Foundation; in tutte le prove con sentinelle, zero segreti nei log/errori/eventi.

## Assumptions

- **Perimetro proposto**: dal brief, sezioni 3, 10 e 12, la feature 002 è il registro di
  repository locali, prima di provider e Discovery. La sequenza è una proposta per review,
  non una roadmap già approvata per tutte le feature successive.
- **Dipendenza**: si estende la nuova Foundation 001, non il precedente Maestro.
  La specifica 002 non certifica né aggira i gate 001 ancora aperti, incluso FR-016
  della 001 per accesso con UID distinto/seconda macchina, attualmente NOT_RUN.
  Il piano dovrà dichiarare le evidenze Foundation richieste prima dell'implementazione.
- **Piattaforma**: resta la prima piattaforma Foundation; supporto completo di altri OS
  non richiesto. Git deve essere disponibile localmente; versione e primitive di
  identificazione/ispezione verranno motivate nel piano tecnico.
- **Repository supportati**: checkout principali locali e worktree collegati già esistenti,
  anche senza commit o senza branch di base configurato ove il checkout sia valido.
  Importare un worktree esistente consente registrazione, osservazione e deduplicazione;
  non ne trasferisce la gestione a Maestro. Restano esclusi clone, inizializzazione,
  import di percorsi bare privi di checkout, filesystem remoti, creazione/gestione worktree e checkout di branch.
- **Nome predefinito**: nome della directory radice del checkout, se conforme a FR-005;
  altrimenti l'utente deve fornirne uno valido. Il nome non conferisce identità.
- **Spostamenti**: un progetto con checkout di riferimento non disponibile resta consultabile.
  Cambio del checkout di riferimento, ricollegamento a una nuova posizione e ripristino
  di una registrazione rimossa sono incrementi futuri;
  l'utente può rimuovere la registrazione e registrare esplicitamente un nuovo progetto.
- **Fuori scope**: Project Discovery e documenti approvati, provider AI/Agent Runtime,
  profili/skill registry, feature/sessioni/run, creazione e cleanup worktree, installazione
  dipendenze/pnpm, merge, push/release/deployment, UI Electron e migrazioni dal vecchio Maestro.
- **Metodo**: questa consegna produce soltanto specifica e checklist di qualità.
  Non definisce schema di persistenza, comandi concreti, librerie, adapter o implementazione;
  non autorizza automaticamente plan, tasks, codice o pubblicazione.
