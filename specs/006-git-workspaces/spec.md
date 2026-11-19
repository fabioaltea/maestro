# Feature Specification: Owned Git Workspaces

**Feature Branch**: `006-git-workspaces`  
**Created**: 2026-11-19  
**Status**: Draft — verificata documentalmente; approvazione di prodotto e implementazione non implicite.  
**Input**: [brief della feature](brief.md), derivato dalla richiesta di completare le feature mancanti di Maestro e dal [brief generale](../../docs/missing-features-brief.md).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Preparare un workspace da un piano approvato (Priority: P1)

Creare un branch dedicato da base locale configurata e un worktree posseduto.

**Why this priority**: Fornisce il primo risultato utile e verificabile della feature.

**Independent Test**: In repository temporaneo creare due workspace per due feature, verificare OID di partenza e snapshot del checkout originale invariato.

**Acceptance Scenarios**:

1. **Given** Handoff corrente e base locale presente, **When** confermo provisioning, **Then** esistono un solo branch dedicato e un worktree associato alla feature.
2. **Given** Branch/path già presenti o base mutata, **When** tento provisioning, **Then** blocco senza riuso o sovrascrittura.

---

### User Story 2 - Osservare, riservare e recuperare workspace (Priority: P1)

Mostrare stato corrente e impedire due writer concorrenti; riconciliare dopo restart senza adottare risorse estranee.

**Why this priority**: Completa il percorso con un incremento verificabile senza confondere il suo esito con le altre fasi del prodotto.

**Independent Test**: Acquisire lease con fixture runtime, tentare secondo writer, perdere owner e verificare che assenza non provata mantenga il blocco.

**Acceptance Scenarios**:

1. **Given** Workspace pronto, **When** un consumer core acquisisce il lease, **Then** un solo holder/generazione può scrivere.
2. **Given** Anchor cambiato o owner non riconciliato, **When** riavvio e richiedo riuso, **Then** stato BLOCKED/RECONCILING e file conservati.

---

### User Story 3 - Rimuovere soltanto un workspace sicuro (Priority: P2)

Liberare lo spazio dopo integrazione dimostrata, conservando il lavoro quando la prova manca.

**Why this priority**: Completa il percorso con un incremento verificabile senza confondere il suo esito con le altre fasi del prodotto.

**Independent Test**: Con HEAD già antenato del target, clean e senza holder, rimuovere workspace e poi branch via CAS; dirty/untracked/commit non integrato producono zero cancellazioni.

**Acceptance Scenarios**:

1. **Given** Workspace clean, quiescente, proprietà e integrazione correnti, **When** confermo rimozione, **Then** solo le risorse possedute vengono rimosse con esito interrogabile.
2. **Given** Nuovo file, commit o processo tra preview e rimozione, **When** confermo vecchio grant, **Then** l’operazione è bloccata e conserva il lavoro.

---

### Edge Cases

- Chiusura/cambio client o archivio: stato autorevole preservato, risposte tardive non applicate ad altro target.
- Retry con UUID originale: stesso intento recupera esito; intento diverso rifiutato senza nuovi effetti.
- Crash prima/dopo un effetto: riconciliare le prove; esito incerto rimane bloccato.
- Input, autorizzazione o contesto cambiati dopo preview: rifiuto e nuova review prima dell’effetto.
- Hook e config Git ostili, branch/path collision, base race, retry, crash fra branch e worktree e checkout originale dirty.
- Writer concorrenti, PID estraneo, worktree spostato/link sostituito, osservazione offline e callback generazione vecchia.
- Dirty tracked/untracked/ignored, HEAD non integrato, conflitti, lease attivo, movimento target, crash remove prima/dopo branchdelete.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Il sistema DEVE richiedere handoff corrente e consenso allo scope prima di creare branch e workspace da una base locale esplicita.
- **FR-002**: Il sistema DEVE generare nomi e percorsi senza collisioni, verificare proprietà e identità del repository e conservare base/versioni esatte.
- **FR-003**: Il sistema DEVE registrare intento ed esito e rendere il provisioning idempotente anche dopo perdita di risposta.
- **FR-004**: Il sistema DEVE esporre osservazioni datate su branch, HEAD, dirty/untracked e proprietà; una lettura offline non certifica stato corrente.
- **FR-005**: Il sistema DEVE consentire lease writer solo a consumer core registrati e generazioni correnti; non rilasciarlo per sola scadenza o morte del client.
- **FR-006**: Il sistema DEVE riconciliare metadata, worktree list, filesystem e ownership prima del riuso dopo crash, distinguendo assente da incerto.
- **FR-007**: Il sistema DEVE richiedere prova corrente che HEAD sia raggiungibile dal target approvato, assenza di modifiche anche ignored/untracked e assenza di processi/consumer attivi.
- **FR-008**: Il sistema DEVE rivalidare scope e proprietà prima di rimozione; branch deletion usa OID atteso, nessun force/prune o scarto implicito.
- **FR-009**: Il sistema DEVE conservare la storia e dichiarare rimozione parziale/incerta dopo crash, senza cancellazioni ripetute alla cieca.
- **FR-010**: Il sistema DEVE esporre le stesse decisioni e gli stessi esiti tramite client headless e desktop; chiusura del client non interrompe lavoro accettato e consultazione offline non avvia effetti.
- **FR-011**: Il sistema DEVE conservare intenzioni, versioni, autorizzazioni ed esiti interrogabili con identità della richiesta, impedendo duplicazioni, effetti senza consenso e riuso di approvazioni obsolete.
- **FR-012**: Il sistema DEVE limitare output e conservazione, rendere visibile saturazione/troncamento e mantenere disponibili consultazione, cancellazione e recovery senza esporre credenziali.

### Key Entities *(include if feature involves data)*

- **Workspace**: Ambiente di lavoro locale dedicato a una feature con branch e base identificati.
- **WorkspaceOwnership**: Prove che collegano le risorse al progetto e alla loro creazione da parte di Maestro.
- **WorkspaceLease**: Assegnazione esclusiva del diritto di scrittura a un’attività corrente.
- **WorkspaceEffect**: Intenzione e prove della creazione o rimozione delle risorse.

### Constitutional Invariants & Required Tests *(mandatory)*

- **I / II — Local-first e core headless**: test contract e integrazione locale: leggere stato offline senza provider/rete, chiudere il client durante lavoro accettato, riaprire e recuperare lo stesso esito. Il client non diventa autorità di policy.
- **III — Provider agnostic**: test unitari/contract con capability mancanti, provider assente e risultati invalidi. Ambito: Nessun provider chiamato; workspace non è confine di sicurezza e non abilita l’esecuzione009.
- **IV — Git safety**: test integrazione locale con stato dirty/conflitti, identità e operazioni concorrenti pertinenti. Esito sicuro richiesto: Lease per repositoryKey + controllo worktree/branch/anchor prima e dopo ogni effetto; niente --force, prune globale, reset o adozione implicita.
- **V — Recovery**: test unitari e integrazione con clock/porte sostituibili, crash pre/post effetto, richiesta duplicata e generazione superata: nessun replay cieco né rilascio di ownership incerta.
- **VI — Approvals**: test unitari/contract/integration con grant assente, stale, di altro ambito/azione e input modificati: nessun effetto e dati conservati.
- **VII — Testability**: tutti i test ordinari del core usano fixture locali e provider simulati senza UI, credenziali reali o servizi esterni; separare test desktop e qualifica reale opt-in.
- **VIII — Observability**: contract e integrazione per correlazioni, redazione, output/quote pieni, troncamento e letture paginabili: errore sicuro e cancel/query/recovery disponibili.
- **Required tests per storia**: i casi US1–US3 ed Edge Cases sono richiesti esplicitamente, con test di transizioni/policy, contratti e integrazione locale prima dell’implementazione pertinente. La parità desktop include conferme, ricevute, tastiera/focus e cambio archivio.
- **Not applicable**: Nessuna installazione, avvio agente, merge o push. Il cleanup di lavoro non integrato resta bloccato; scarto distruttivo è escluso dalla prima versione. Nessun test deve introdurre tali operazioni o ricreare campagne lunghe rinviate. Un’assenza di capability è un esito osservabile, non un successo simulato.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Due feature fixture hanno directory e branch distinti e modifiche reciprocamente indipendenti.
- **SC-002**: Nel 100% dei casi dirty, in uso, non integrati o con proprietà incerta il cleanup preserva file e commit.
- **SC-003**: Dieci retry dello stesso provisioning creano un solo branch/worktree.
- **SC-004**: Ogni fault pre/post creazione lascia un workspace riconciliato oppure un blocco esplicito, mai una seconda creazione cieca.

## Assumptions

- Destinatario: singolo utente locale che gestisce più progetti, con gli stessi confini di fiducia e prima piattaforma della base Maestro.
- 005 per handoff corrente;002 per repository identity, baseBranch configurato e ispezione. Schema6 segue5.
- Ambito: Provisioning da feature approvata; osservazione/lease; riconciliazione e cleanup esplicito senza perdita. CLI e desktop. Esclusioni: Nessuna installazione, avvio agente, merge o push. Il cleanup di lavoro non integrato resta bloccato; scarto distruttivo è escluso dalla prima versione.
- Gli esempi fixture permettono verifica locale dei comportamenti; non sostituiscono qualifica provider, autorizzazioni reali o approvazione di prodotto.
- I criteri quantitativi sono target della futura implementazione, non misure già raggiunte; non richiedono campagne di volume/durata.
