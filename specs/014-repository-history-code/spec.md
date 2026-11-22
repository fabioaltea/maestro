# Feature Specification: Storico Git ed esploratore di `main`

**Feature Branch**: `016-repository-history-code`

**Created**: 2026-11-22

**Status**: Draft

**Input**: Aggiungere al repository una vista dello storico Git con worktree e una vista del codice di `main` in stile VS Code.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Esplorare lo storico Git e i worktree (Priority: P1)

Chi segue il lavoro nel repository apre **Storico Git** per capire come si sono sviluppati i branch, cosa contiene un commit e quale revisione è attiva in ogni worktree.

**Why this priority**: Permette di orientarsi sul lavoro parallelo senza passare al terminale o spostare il checkout.

**Independent Test**: Aprire un repository di prova con un merge, un tag, un branch di lavoro e un worktree con HEAD scollegato. Verificare che l'intero scenario funzioni senza aprire la vista Codice.

**Acceptance Scenarios**:

1. **Given** un repository con branch divergenti, un merge e un tag, **When** l'utente apre Storico Git, **Then** il grafo mostra le relazioni tra commit e le etichette delle revisioni locali, incluse le copie locali dei riferimenti remoti disponibili.
2. **Given** un worktree su un branch e uno con HEAD scollegato, **When** l'utente seleziona ciascun worktree, **Then** distingue il percorso e la revisione attiva e può raggiungere il relativo commit.
3. **Given** un commit selezionato, **When** l'utente ne apre i dettagli, **Then** vede identificativo, autore, data, messaggio e file modificati; un merge indica il genitore rispetto a cui è mostrato l'elenco.
4. **Given** che un altro processo sposta un branch o modifica un worktree, **When** l'utente aggiorna la vista, **Then** vede la nuova osservazione o un errore esplicito, senza operazioni automatiche che modifichino Git.

---

### User Story 2 - Leggere il codice pubblicato sul `main` locale (Priority: P2)

Chi legge il codice apre **Codice**, sfoglia le cartelle in un albero laterale e apre i file in schede consultabili, senza confondere il contenuto committato con le modifiche dei worktree.

**Why this priority**: Consente di consultare il codice di riferimento rimanendo nel contesto del repository.

**Independent Test**: Usare un repository con `main`, un branch diverso in checkout e modifiche non committate allo stesso file. Aprire Codice e verificare che albero e contenuto corrispondano esclusivamente a `main`.

**Acceptance Scenarios**:

1. **Given** un checkout su un branch diverso da `main`, **When** l'utente apre Codice ed espande una cartella, **Then** vede i file del commit di `main` indicato nella vista.
2. **Given** due file di testo, **When** l'utente li apre, cambia scheda e cerca una stringa nel file attivo, **Then** vede il percorso, i numeri di riga, le corrispondenze e la sintassi evidenziata per i formati supportati, senza possibilità di salvare modifiche.
3. **Given** che `main` avanza mentre l'utente legge, **When** l'utente apre altri file senza aggiornare la vista, **Then** continua a leggere lo stesso commit; l'aggiornamento esplicito passa al nuovo commit senza mescolare versioni.
4. **Given** che `main` non esiste oppure che un file non è visualizzabile, **When** l'utente apre la vista o il file, **Then** riceve un messaggio specifico e non viene reindirizzato a un altro branch o a un file sul disco.

### Edge Cases

- Repository senza commit: Storico Git spiega che non ci sono revisioni; Codice indica che il `main` locale non è consultabile.
- Worktree bloccati, non raggiungibili o con stato non verificabile: la vista distingue lo stato noto da quello sconosciuto e non certifica come pulito un worktree non verificato.
- File binari, collegamenti simbolici e riferimenti a sottomoduli: la vista mostra il tipo senza aprire risorse esterne; oltre 1 MiB non tenta di caricare il contenuto del file.
- Cronologie lunghe e directory grandi: i risultati iniziali sono limitati ed è possibile caricare altri elementi senza duplicati né cambi di revisione impliciti.
- Repository spostato, lettura interrotta o risposta in ritardo dopo un cambio di repository: la vista non attribuisce dati vecchi al repository attivo; mostra uno stato esplicito e permette il retry quando applicabile.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: La navigazione del repository selezionato DEVE offrire due ingressi distinti, **Storico Git** e **Codice**.
- **FR-002**: Storico Git DEVE mostrare un grafo navigabile dei commit, le relazioni genitore-figlio, branch locali, tag e riferimenti remoti già presenti in locale. L'utente DEVE poter proseguire oltre il primo gruppo di commit.
- **FR-003**: La selezione di un commit DEVE mostrare identificativo, autore, data, messaggio e percorsi modificati. Per un merge, la vista DEVE indicare il genitore rispetto a cui sono elencate le modifiche.
- **FR-004**: Storico Git DEVE mostrare i worktree del repository, gestiti o meno da Maestro, con percorso, branch o HEAD scollegato e commit corrente quando noto. DEVE distinguere i worktree bloccati e non verificabili e permettere di raggiungere un commit corrente disponibile.
- **FR-005**: Codice DEVE mostrare un albero espandibile dei file committati nel `main` locale e visualizzare l'identificativo del commit consultato. L'albero e i file DEVONO provenire dallo stesso commit fino a un aggiornamento esplicito.
- **FR-006**: Codice DEVE consentire l'apertura di più file in schede con percorso, numeri di riga, ricerca nel file attivo ed evidenziazione per i formati supportati. Il testo valido nei formati non riconosciuti DEVE rimanere leggibile senza evidenziazione.
- **FR-007**: Le due viste DEVONO distinguere assenza di dati, errore di lettura e caricamento. Codice DEVE indicare perché non può aprire un file oltre 1 MiB, binario o non rappresentato da un file di testo normale nel commit, senza seguire collegamenti o consultare sottomoduli.
- **FR-008**: Le due viste DEVONO essere consultabili offline e in sola lettura. Navigazione, refresh, retry e consultazione concorrente NON DEVONO cambiare branch, indici, file di lavoro o riferimenti, né contattare remoti o provider.
- **FR-009**: Dopo il cambio di repository, albero, schede e storico DEVONO appartenere esclusivamente al repository attivo, anche quando una lettura precedente termina in ritardo.

### Key Entities *(include if feature involves data)*

- **Commit**: Revisione identificabile con genitori, autore, data, messaggio e percorsi modificati.
- **Riferimento Git**: Nome di branch o tag associato a una revisione disponibile localmente.
- **Worktree osservato**: Percorso di lavoro collegato al repository con branch, revisione e stato di disponibilità.
- **Snapshot di `main`**: Commit locale identificato da cui derivano albero e file di una sessione di lettura.

### Constitutional Invariants & Required Tests *(mandatory)*

- **Principles affected**: I, II, IV, V, VII e VIII. La consultazione rimane locale; il core limita accesso e scope al repository selezionato; le letture preservano lo stato Git; gli errori e l'indisponibilità sono riconoscibili senza registrare il contenuto dei file.
- **Required tests**: Test di contratto per repository non disponibile, `main` assente, tentativi di lettura fuori dallo snapshot e limiti dichiarati. Test di integrazione locale con commit divergenti, merge, tag, worktree gestiti ed esterni, HEAD scollegato, `main` che avanza, checkout sporco e letture ripetute o concorrenti. Verificare l'identità di albero e file rispetto al commit indicato e l'assenza di modifiche a indici, riferimenti o file. Test Desktop per le due navigazioni e per risposte tardive dopo un cambio di repository. Testare disconnessione e riconnessione: la lettura interrotta non appare riuscita e il retry non modifica il repository.
- **Not applicable**: III e VI: nessun provider o azione che richieda approvazione. Non ci sono mutazioni da riconciliare dopo un crash né approvazioni che possano diventare obsolete.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In una fixture con 100 commit, 5 branch e 3 worktree, l'utente vede il primo gruppo dello storico e l'elenco dei worktree entro 3 secondi dall'apertura della vista in almeno 9 prove su 10, con repository disponibile localmente.
- **SC-002**: In 10 prove con checkout diversi da `main` o modifiche non committate, tutti i file mostrati corrispondono al commit di `main` indicato e nessuno proviene dal checkout.
- **SC-003**: Almeno 4 utenti su 5, al primo tentativo e senza terminale, individuano il commit di un worktree e aprono un file indicato su `main` in meno di 90 secondi complessivi.
- **SC-004**: In tutti gli scenari di consultazione offline, refresh e retry della suite di accettazione, i riferimenti, gli indici e i file di lavoro rimangono invariati.

## Assumptions

- `main` significa il branch locale esatto, non `origin/main` né un branch predefinito alternativo. La vista non sincronizza dati da remoto.
- «Stile VS Code» riguarda la disposizione a esploratore e schede e le funzioni di lettura; modifica, estensioni, terminale, ricerca globale nei file e operazioni Git sono fuori scope.
- Il repository è già aperto in Maestro. Le due viste non cambiano i flussi esistenti di pianificazione, analisi o gestione dei workspace.
