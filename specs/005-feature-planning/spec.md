# Feature Specification: Feature Planning & Versioned Approval

**Feature Branch**: `005-feature-planning`
**Created**: 2026-11-19
**Status**: Draft — verificata documentalmente; approvazione di prodotto e implementazione non implicite.
**Input**: [brief della feature](brief.md), derivato dalla richiesta di completare le feature mancanti di Maestro e dal [brief generale](../../docs/missing-features-brief.md).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Creare e correggere una feature (Priority: P1)

Descrivere una richiesta, compilare specifica e piano e conservare revisioni senza eseguire codice.

**Why this priority**: Fornisce il primo risultato utile e verificabile della feature.

**Independent Test**: Con progetto fixture approvato creare una feature manuale, revisionarla e rileggerla dopo restart; senza approvazione valida non compare alcuna nuova feature.

**Acceptance Scenarios**:

1. **Given** Discovery corrente e richiesta valida, **When** creo e ripeto lo stesso comando, **Then** esiste una sola bozza con richiesta e riferimenti al contesto.
2. **Given** Discovery assente, scaduta o progetto rimosso, **When** tento la creazione, **Then** il core rifiuta e conserva i dati precedenti.

---

### User Story 2 - Approvare un piano e preparare l’implementazione (Priority: P1)

Approvare una precisa revisione e produrre un handoff che i moduli successivi possano rivalidare.

**Why this priority**: Completa il percorso con un incremento verificabile senza confondere il suo esito con le altre fasi del prodotto.

**Independent Test**: Approvare un bundle fixture, ottenere envelope, mutare contesto o piano e verificare che ogni handoff successivo sia rifiutato mentre la decisione storica resta leggibile.

**Acceptance Scenarios**:

1. **Given** Bundle completo con criteri e contesto corrente, **When** approvo e preparo l’handoff, **Then** l’approvazione lega entrambe le specifiche e le assunzioni accettate.
2. **Given** Contesto o bundle cambiato dopo l’approvazione, **When** richiedo handoff, **Then** NEEDS_REVIEW, nessuna esecuzione autorizzata.

---

### User Story 3 - Ottenere una bozza assistita e rispondere alle domande (Priority: P2)

Richiedere analisi readonly e rispondere a domande mantenendo le assunzioni visibili.

**Why this priority**: Completa il percorso con un incremento verificabile senza confondere il suo esito con le altre fasi del prodotto.

**Independent Test**: Provider simulato produce una domanda e una bozza; due turni espliciti conservano risposte/provenance; provider indisponibile lascia utilizzabile il documento manuale.

**Acceptance Scenarios**:

1. **Given** Bozza e invio al provider autorizzato, **When** richiedo generazione, **Then** un turno readonly produce bozza o domande senza modificare il progetto.
2. **Given** Provider indisponibile o risposta tardiva dopo revisione, **When** arriva un risultato, **Then** si registra errore o risultato superato senza sovrascrivere la revisione corrente.

---

### Edge Cases

- Chiusura/cambio client o archivio: stato autorevole preservato, risposte tardive non applicate ad altro target.
- Retry con UUID originale: stesso intento recupera esito; intento diverso rifiutato senza nuovi effetti.
- Crash prima/dopo un effetto: riconciliare le prove; esito incerto rimane bloccato.
- Input, autorizzazione o contesto cambiati dopo preview: rifiuto e nuova review prima dell’effetto.
- Creation senza Discovery, race freshness, revisione concorrente, corpi grandi sigillati, rimozione progetto e retry dopo risposta persa.
- Approval assente/stale, contesto cambiato tra prepare e consumo, progetto reimportato e collisione UUID cross namespace.
- Schema/provenance invalida, consenso stale, provider unsafe/auth/quota, timeout/cancel e late result di generazione precedente.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Il sistema DEVE consentire creazione solo con approvazione Discovery attuale rivalidata dal core, mai dal solo stato mostrato dal client.
- **FR-002**: Il sistema DEVE conservare richiesta, specifica, piano e criteri in revisioni immutabili, con provenienza e ambiguità dichiarate.
- **FR-003**: Il sistema DEVE consentire modifica manuale, elenco, lettura e archivio senza eliminare revisioni referenziate o feature in uso.
- **FR-004**: Il sistema DEVE consentire approvazione solo di un bundle completo con criteri verificabili e accettazione esplicita delle incertezze dichiarate.
- **FR-005**: Il sistema DEVE legare l’approvazione a revisione, digest del bundle e contesto approvato; modifiche rilevanti invalidano eligibility corrente senza riscrivere la storia.
- **FR-006**: Il sistema DEVE esporre handoff provider-neutral per workspace ed esecuzione; distinguere approvazione del piano da grant di esecuzione, integrazione e pubblicazione.
- **FR-007**: Il sistema DEVE generare solo su consenso relativo a corpus, provider, revisione e modello; nessun avvio automatico dalla lettura.
- **FR-008**: Il sistema DEVE conservare domande, risposte confermate, ipotesi e copertura delle fonti; un nuovo turno è esplicito e versionato.
- **FR-009**: Il sistema DEVE rifiutare risultati malformati o superati, preservare output parziale bounded e rendere possibile cancel/recovery senza run duplicati.
- **FR-010**: Il sistema DEVE esporre le stesse decisioni e gli stessi esiti tramite client headless e desktop; chiusura del client non interrompe lavoro accettato e consultazione offline non avvia effetti.
- **FR-011**: Il sistema DEVE conservare intenzioni, versioni, autorizzazioni ed esiti interrogabili con identità della richiesta, impedendo duplicazioni, effetti senza consenso e riuso di approvazioni obsolete.
- **FR-012**: Il sistema DEVE limitare output e conservazione, rendere visibile saturazione/troncamento e mantenere disponibili consultazione, cancellazione e recovery senza esporre credenziali.

### Key Entities *(include if feature involves data)*

- **Feature**: Richiesta di lavoro di un progetto, con titolo, stato e revisione corrente.
- **FeatureRevision**: Versione immutabile di richiesta, specifica, piano e criteri di accettazione.
- **FeatureApproval**: Decisione dell’utente riferita a una precisa revisione e al contesto approvato.
- **PlanningTurn**: Turno di analisi e intervista con domande, risposte ed esito conservati.
- **ImplementationEnvelope**: Pacchetto approvato che descrive il lavoro da consegnare all’implementazione.

### Constitutional Invariants & Required Tests *(mandatory)*

- **I / II — Local-first e core headless**: test contract e integrazione locale: leggere stato offline senza provider/rete, chiudere il client durante lavoro accettato, riaprire e recuperare lo stesso esito. Il client non diventa autorità di policy.
- **III — Provider agnostic**: test unitari/contract con capability mancanti, provider assente e risultati invalidi. Ambito: Manuale sempre senza inferenza; generazione disabilitata se provider non qualificato. Nessun nuovo SDK, API key o fallback per aggirare004.
- **IV — Git safety**: test integrazione locale con stato dirty/conflitti, identità e operazioni concorrenti pertinenti. Esito sicuro richiesto: Repository e Git in sola lettura; verificare il contesto Discovery corrente prima di creazione, approvazione e rilascio dell’handoff.
- **V — Recovery**: test unitari e integrazione con clock/porte sostituibili, crash pre/post effetto, richiesta duplicata e generazione superata: nessun replay cieco né rilascio di ownership incerta.
- **VI — Approvals**: test unitari/contract/integration con grant assente, stale, di altro ambito/azione e input modificati: nessun effetto e dati conservati.
- **VII — Testability**: tutti i test ordinari del core usano fixture locali e provider simulati senza UI, credenziali reali o servizi esterni; separare test desktop e qualifica reale opt-in.
- **VIII — Observability**: contract e integrazione per correlazioni, redazione, output/quote pieni, troncamento e letture paginabili: errore sicuro e cancel/query/recovery disponibili.
- **Required tests per storia**: i casi US1–US3 ed Edge Cases sono richiesti esplicitamente, con test di transizioni/policy, contratti e integrazione locale prima dell’implementazione pertinente. La parità desktop include conferme, ricevute, tastiera/focus e cambio archivio.
- **Not applicable**: Nessun branch/worktree, installazione, implementazione, merge o pubblicazione. Non riutilizzare ArchitectResult come se fosse una specifica feature. Nessun test deve introdurre tali operazioni o ricreare campagne lunghe rinviate. Un’assenza di capability è un esito osservabile, non un successo simulato.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In 10 scenari con Discovery valida, l’utente crea, rilegge e corregge una bozza conservando tutte le revisioni.
- **SC-002**: Nel 100% dei casi senza Discovery corrente o con piano cambiato, creazione o rilascio all’implementazione sono bloccati.
- **SC-003**: Una richiesta ripetuta 10 volte produce una sola feature o revisione e lo stesso esito osservabile.
- **SC-004**: Specifica, piano e criteri approvati sono recuperabili offline con identità e data in tutti i casi di riavvio provati.

## Assumptions

- Destinatario: singolo utente locale che gestisce più progetti, con gli stessi confini di fiducia e prima piattaforma della base Maestro.
- 004 per projectId, documento approvato ed eligibility attuale. Il percorso reale dipende dalla chiusura del blocco provider004; fixture approvate servono solo nei test. Non dipende009.
- Ambito: Authoring manuale completo; generazione assistita readonly opzionale con intervista; revisioni append-only, approvazione e handoff. CLI e desktop. Esclusioni: Nessun branch/worktree, installazione, implementazione, merge o pubblicazione. Non riutilizzare ArchitectResult come se fosse una specifica feature.
- Gli esempi fixture permettono verifica locale dei comportamenti; non sostituiscono qualifica provider, autorizzazioni reali o approvazione di prodotto.
- I criteri quantitativi sono target della futura implementazione, non misure già raggiunte; non richiedono campagne di volume/durata.
