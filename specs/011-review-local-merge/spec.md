# Feature Specification: Review, Validation & Safe Local Merge

**Feature Branch**: `011-review-local-merge`
**Created**: 2026-11-19
**Status**: Draft — verificata documentalmente; approvazione di prodotto e implementazione non implicite.
**Input**: [brief della feature](brief.md), derivato dalla richiesta di completare le feature mancanti di Maestro e dal [brief generale](../../docs/missing-features-brief.md).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Revisionare diff, criteri e controlli correnti (Priority: P1)

Vedere modifiche e verifiche relative all’esatto lavoro prima di decidere l’integrazione.

**Why this priority**: Fornisce il primo risultato utile e verificabile della feature.

**Independent Test**: Creare snapshot da run fixture quiescente, eseguire check locali, cambiare un file e verificare che le prove precedenti diventino stale.

**Acceptance Scenarios**:

1. **Given** Checkpoint quiescente e piano corrente, **When** apro review e lancio check approvati, **Then** diff/criteri/doc hanno riferimenti e risultati legati allo stesso tree.
2. **Given** Check fallito, non eseguito o output incompleto, **When** richiedo approvazione, **Then** blocco o richiesta correzioni con motivo senza falso PASS.

---

### User Story 2 - Approvare e integrare un candidate locale sicuro (Priority: P1)

Preparare il risultato del merge e approvarne l’integrazione sul target locale previsto.

**Why this priority**: Completa il percorso con un incremento verificabile senza confondere il suo esito con le altre fasi del prodotto.

**Independent Test**: Su target libero prenotare guard, creare candidate con conflitto o successo; approvare successo, effettuare CAS e fault nei passaggi, verificando OID/prove.

**Acceptance Scenarios**:

1. **Given** Target libero, candidate validato e grant corrente, **When** approvo integrazione, **Then** ref passa da oldOid a candidateOid una sola volta e risultato è registrato.
2. **Given** Target in checkout esterno, mosso o conflitto, **When** preparo o consumo grant, **Then** blocco con lavoro preservato e nessun force/reset.

---

### User Story 3 - Concludere review e aggiornare contesto e risorse (Priority: P2)

Mostrare integrazione, documentazione, freshness del progetto ed eventuale cleanup sicuro.

**Why this priority**: Completa il percorso con un incremento verificabile senza confondere il suo esito con le altre fasi del prodotto.

**Independent Test**: Integrare fixture, rilevare Discovery stale per cambi rilevanti, richiedere cleanup006 con proof e verificare che lavoro nuovo blocchi la rimozione.

**Acceptance Scenarios**:

1. **Given** Integrazione provata e documenti inclusi nel candidate, **When** concludo review, **Then** vedo commit finale e nuovo stato contesto, con cleanup separato.
2. **Given** Workspace modificato dopo merge o doc incoerenti, **When** richiedo cleanup o nuova feature, **Then** blocco sicuro e percorso per aggiornare Discovery/review.

---

### Edge Cases

- Chiusura/cambio client o archivio: stato autorevole preservato, risposte tardive non applicate ad altro target.
- Retry con UUID originale: stesso intento recupera esito; intento diverso rifiutato senza nuovi effetti.
- Crash prima/dopo un effetto: riconciliare le prove; esito incerto rimane bloccato.
- Input, autorizzazione o contesto cambiati dopo preview: rifiuto e nuova review prima dell’effetto.
- Dirty/untracked diff, checks exit0 ma incomplete, artifact corrupt, stale tree/plan, UI output ostile e readonly reviewer.
- Target in use, candidate changed, target CAS race, conflict preservation, crash before/after refchange e guard injected file, no duplicate merge.
- New commit dopo merge, doc changed, freshness invalidation, no automatic Discovery call, cleanup proof expired e release grant assente.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Il sistema DEVE produrre snapshot immutabile di source/target/piano, diff e criteri solo da lavoro quiescente con proprietà verificata.
- **FR-002**: Il sistema DEVE eseguire controlli approvati e collegare esiti/prove all’esatto tree e CommandSpec; distinguere PASS,FAIL,NOT_RUN,BLOCKED.
- **FR-003**: Il sistema DEVE consentire feedback e richieste di correzione, includendo documentazione e criteri aggiornati nel nuovo ciclo senza riusare prove stale.
- **FR-004**: Il sistema DEVE preparare candidate immutabile senza toccare checkout utente; target già in uso esterno o conflitto blocca l’operazione.
- **FR-005**: Il sistema DEVE richiedere approvazione distinta su candidate, targetOid, piano e prove correnti; rivalidare precondizioni e aggiornare ref con confronto OID atomico.
- **FR-006**: Il sistema DEVE riconciliare crash/timeout con intenzione, ref e proof senza ripetere merge o perdere file; incertezza conserva guard e blocca nuovi effetti.
- **FR-007**: Il sistema DEVE registrare collegamenti tra integrazione, criteri, documenti e commit risultante senza equiparare merge locale a pubblicazione.
- **FR-008**: Il sistema DEVE ricalcolare freshness del contesto progetto dopo integrazione e richiedere aggiornamento Discovery quando previsto dalle sue regole.
- **FR-009**: Il sistema DEVE offrire cleanup006 solo con prova corrente di integrazione e quiescenza, conservando storia e lavoro non integrato.
- **FR-010**: Il sistema DEVE esporre le stesse decisioni e gli stessi esiti tramite client headless e desktop; chiusura del client non interrompe lavoro accettato e consultazione offline non avvia effetti.
- **FR-011**: Il sistema DEVE conservare intenzioni, versioni, autorizzazioni ed esiti interrogabili con identità della richiesta, impedendo duplicazioni, effetti senza consenso e riuso di approvazioni obsolete.
- **FR-012**: Il sistema DEVE limitare output e conservazione, rendere visibile saturazione/troncamento e mantenere disponibili consultazione, cancellazione e recovery senza esporre credenziali.

### Key Entities *(include if feature involves data)*

- **ReviewSnapshot**: Versione delle modifiche da revisionare con piano, target, documentazione e prove.
- **ValidationEvidence**: Risultato corrente di un controllo riferito a un criterio e al lavoro verificato.
- **ReviewDecision**: Feedback o approvazione dell’utente su un preciso risultato proposto.
- **IntegrationCandidate**: Risultato immutabile proposto per l’integrazione sul target locale.
- **IntegrationOperation**: Intenzione e prove del passaggio dal target precedente al risultato approvato.

### Constitutional Invariants & Required Tests *(mandatory)*

- **I / II — Local-first e core headless**: test contract e integrazione locale: leggere stato offline senza provider/rete, chiudere il client durante lavoro accettato, riaprire e recuperare lo stesso esito. Il client non diventa autorità di policy.
- **III — Provider agnostic**: test unitari/contract con capability mancanti, provider assente e risultati invalidi. Ambito: Reviewer assistito opzionale tramite009 con scope readonly qualificato; commenti AI non conferiscono autorizzazione e non sostituiscono prove dei criteri.
- **IV — Git safety**: test integrazione locale con stato dirty/conflitti, identità e operazioni concorrenti pertinenti. Esito sicuro richiesto: Candidate in staging detached posseduto; target deve essere libero e riservato dal guard worktree core. Update-ref con oldOid atteso; niente checkout/merge/reset nel checkout dell’utente.
- **V — Recovery**: test unitari e integrazione con clock/porte sostituibili, crash pre/post effetto, richiesta duplicata e generazione superata: nessun replay cieco né rilascio di ownership incerta.
- **VI — Approvals**: test unitari/contract/integration con grant assente, stale, di altro ambito/azione e input modificati: nessun effetto e dati conservati.
- **VII — Testability**: tutti i test ordinari del core usano fixture locali e provider simulati senza UI, credenziali reali o servizi esterni; separare test desktop e qualifica reale opt-in.
- **VIII — Observability**: contract e integrazione per correlazioni, redazione, output/quote pieni, troncamento e letture paginabili: errore sicuro e cancel/query/recovery disponibili.
- **Required tests per storia**: i casi US1–US3 ed Edge Cases sono richiesti esplicitamente, con test di transizioni/policy, contratti e integrazione locale prima dell’implementazione pertinente. La parità desktop include conferme, ricevute, tastiera/focus e cambio archivio.
- **Not applicable**: Nessun push, PR o deploy, force/reset/stash checkout utente o risoluzione conflitti automatica. Target in checkout esterno blocca il merge. Nessun test deve introdurre tali operazioni o ricreare campagne lunghe rinviate. Un’assenza di capability è un esito osservabile, non un successo simulato.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Ogni criterio nei 10 snapshot fixture ha una prova corrente o un esito esplicito diverso da PASS; nessun criterio obbligatorio mancante viene approvato.
- **SC-002**: Nei casi target dirty/in uso, source mutata o conflitto, checkout e commit utente restano identici.
- **SC-003**: Dieci retry/fault a cavallo del cambio ref producono al massimo una integrazione e stato verificabile o blocco esplicito.
- **SC-004**: Dopo integrazione la feature mostra l’OID risultante e la documentazione aggiornata; cleanup avviene solo quando la prova corrente è sicura.

## Assumptions

- Destinatario: singolo utente locale che gestisce più progetti, con gli stessi confini di fiducia e prima piattaforma della base Maestro.
- 005 piano/criteri correnti,006 ownership e mutatore,007 job validazione,008 Reviewer,009 checkpoint e quiescenza.010 è baseline schema cumulativa; il caso singolo non richiede policy scheduling avanzate.
- Ambito: Diff/commit, criteri, validazioni aggiornate, correzioni e approvazione integrazione; candidate immutabile e merge locale controllato; handoff cleanup006 e documentazione. Esclusioni: Nessun push, PR o deploy, force/reset/stash checkout utente o risoluzione conflitti automatica. Target in checkout esterno blocca il merge.
- Gli esempi fixture permettono verifica locale dei comportamenti; non sostituiscono qualifica provider, autorizzazioni reali o approvazione di prodotto.
- I criteri quantitativi sono target della futura implementazione, non misure già raggiunte; non richiedono campagne di volume/durata.
