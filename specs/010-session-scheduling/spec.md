# Feature Specification: Session Scheduling, Quotas & Provider Policies

**Feature Branch**: `010-session-scheduling`
**Created**: 2026-11-19
**Status**: Draft — verificata documentalmente; approvazione di prodotto e implementazione non implicite.
**Input**: [brief della feature](brief.md), derivato dalla richiesta di completare le feature mancanti di Maestro e dal [brief generale](../../docs/missing-features-brief.md).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Accodare e limitare il lavoro tra progetti (Priority: P1)

Eseguire più sessioni senza saturare risorse o far scrivere due agenti nello stesso workspace.

**Why this priority**: Fornisce il primo risultato utile e verificabile della feature.

**Independent Test**: Con clock controllato e tre progetti accodare12job; osservare round-robin e cap4/2/2 più lease, poi simulare restart a reservation.

**Acceptance Scenarios**:

1. **Given** Più progetti e budget disponibile, **When** accodo job idonei, **Then** la coda equa avvia solo entro limiti e lease.
2. **Given** Budget esaurito o owner incerto, **When** accodo un nuovo job, **Then** WAITING_RESOURCE/RECONCILING conserva debit senza spawn.

---

### User Story 2 - Attendere quote e riprendere con policy sticky (Priority: P1)

Vedere perché una sessione attende e decidere quando tentare di nuovo senza polling o retry ciechi.

**Why this priority**: Completa il percorso con un incremento verificabile senza confondere il suo esito con le altre fasi del prodotto.

**Independent Test**: Provider fixture segnala QUOTA con reset noto/ignoto; avanzare clock, revocare consenso e verificare che parta al massimo un nuovo run autorizzato.

**Acceptance Scenarios**:

1. **Given** Quota con reset dichiarato e policy valida, **When** il clock raggiunge l’orario, **Then** il core rivalida e avvia al massimo un tentativo autorizzato.
2. **Given** Reset ignoto o policy revocata, **When** trascorre tempo o riavvio, **Then** sessione resta in attesa e richiede scelta senza inferenza automatica.

---

### User Story 3 - Applicare fallback e scelta per costo con checkpoint (Priority: P2)

Scegliere alternative compatibili e autorizzate preservando lavoro e privacy.

**Why this priority**: Completa il percorso con un incremento verificabile senza confondere il suo esito con le altre fasi del prodotto.

**Independent Test**: Due provider simulati con capability differenti: autorizzare policy fallback, provare switch sicuro; costo/capability ignoti bloccano cost-aware senza inviare dati.

**Acceptance Scenarios**:

1. **Given** Policy alternativa compatibile e checkpoint quiescente, **When** provider diventa indisponibile, **Then** nuovo run sull’alternativa ammessa con storia collegata.
2. **Given** Provider nuovo non autorizzato, costo ignoto o vecchio processo vivo, **When** valuto fallback, **Then** blocco con motivo, nessun doppio run o invio aggiuntivo.

---

### Edge Cases

- Chiusura/cambio client o archivio: stato autorevole preservato, risposte tardive non applicate ad altro target.
- Retry con UUID originale: stesso intento recupera esito; intento diverso rifiutato senza nuovi effetti.
- Crash prima/dopo un effetto: riconciliare le prove; esito incerto rimane bloccato.
- Input, autorizzazione o contesto cambiati dopo preview: rifiuto e nuova review prima dell’effetto.
- Fairness, cap combinati, doppio writer, queue full, restart fra reserve/spawn e debit di processi unknown.
- Reset null, clock avanti/indietro, duplicate wake, restart, revoke prima dispatch, budget3attempt e quota non-auth error.
- New recipient consent, tool mismatch, oldrun alive/unknown, stale checkpoint, missing/stale prices e policy revoke race.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Il sistema DEVE persistire coda, priorità e limiti globali/per classe, mantenendo fairness tra progetti e un writer/workspace.
- **FR-002**: Il sistema DEVE acquisire reservation e intento di avvio atomicamente, rilasciandoli solo su prova valida di mancato avvio o uscita.
- **FR-003**: Il sistema DEVE esporre coda, motivo attesa e uso risorse anche headless; le soglie soft non devono essere presentate come hard quota garantita.
- **FR-004**: Il sistema DEVE normalizzare disponibilità/quote con fonte e timestamp, lasciando assenti i dati non esposti dal provider.
- **FR-005**: Il sistema DEVE supportare sticky e ripresa programmata esplicitamente autorizzata con limite tentativi, rivalidazione del checkpoint e nessun busy loop.
- **FR-006**: Il sistema DEVE consentire pausa/cancel/revoca in coda e attesa, rendendoli durevoli e applicati anche dopo restart o cambio clock.
- **FR-007**: Il sistema DEVE permettere fallback solo verso provider qualificati, con permessi/capability sufficienti e consenso sul nuovo destinatario dei dati.
- **FR-008**: Il sistema DEVE usare checkpoint portabile e nuova generation; verificare stop locale del run precedente e invalidare approvazioni dipendenti da input cambiati.
- **FR-009**: Il sistema DEVE abilitare cost-aware solo con dati di costo datati/comparabili e budget approvato; mostrare indisponibilità e richiedere decisione quando mancano dati.
- **FR-010**: Il sistema DEVE esporre le stesse decisioni e gli stessi esiti tramite client headless e desktop; chiusura del client non interrompe lavoro accettato e consultazione offline non avvia effetti.
- **FR-011**: Il sistema DEVE conservare intenzioni, versioni, autorizzazioni ed esiti interrogabili con identità della richiesta, impedendo duplicazioni, effetti senza consenso e riuso di approvazioni obsolete.
- **FR-012**: Il sistema DEVE limitare output e conservazione, rendere visibile saturazione/troncamento e mantenere disponibili consultazione, cancellazione e recovery senza esporre credenziali.

### Key Entities *(include if feature involves data)*

- **ScheduledJob**: Attività in coda con progetto, priorità, orario e motivo di attesa.
- **ResourcePolicy**: Limiti e criteri di ripartizione delle risorse approvati dall’utente.
- **ResourceReservation**: Risorse assegnate a una precisa attività fino a prova del rilascio.
- **ProviderWait**: Motivo di indisponibilità del provider, fonte e possibile orario di ripristino.
- **ProviderPolicy**: Scelta sticky, fallback o basata sul costo con alternative e limiti autorizzati.
- **SwitchDecision**: Decisione di cambiare provider legata a checkpoint e compatibilità verificata.

### Constitutional Invariants & Required Tests *(mandatory)*

- **I / II — Local-first e core headless**: test contract e integrazione locale: leggere stato offline senza provider/rete, chiudere il client durante lavoro accettato, riaprire e recuperare lo stesso esito. Il client non diventa autorità di policy.
- **III — Provider agnostic**: test unitari/contract con capability mancanti, provider assente e risultati invalidi. Ambito: Sticky default; fallback solo verso adapter qualificato compatibile e autorizzato, dopo prova stop e checkpoint. Cost-aware usa solo stime esplicite datate e comparabili, altrimenti WAITING_USER.
- **IV — Git safety**: test integrazione locale con stato dirty/conflitti, identità e operazioni concorrenti pertinenti. Esito sicuro richiesto: Nessuna nuova mutazione Git; rispettare lease006 di un writer/workspace anche con più sessioni sullo stesso repository.
- **V — Recovery**: test unitari e integrazione con clock/porte sostituibili, crash pre/post effetto, richiesta duplicata e generazione superata: nessun replay cieco né rilascio di ownership incerta.
- **VI — Approvals**: test unitari/contract/integration con grant assente, stale, di altro ambito/azione e input modificati: nessun effetto e dati conservati.
- **VII — Testability**: tutti i test ordinari del core usano fixture locali e provider simulati senza UI, credenziali reali o servizi esterni; separare test desktop e qualifica reale opt-in.
- **VIII — Observability**: contract e integrazione per correlazioni, redazione, output/quote pieni, troncamento e letture paginabili: errore sicuro e cancel/query/recovery disponibili.
- **Required tests per storia**: i casi US1–US3 ed Edge Cases sono richiesti esplicitamente, con test di transizioni/policy, contratti e integrazione locale prima dell’implementazione pertinente. La parità desktop include conferme, ricevute, tastiera/focus e cambio archivio.
- **Not applicable**: Nessun provider extra non qualificato, previsione inventata di quote/prezzi/reset, cron distribuito, autoscaling cloud o benchmark di lunga durata. Nessun test deve introdurre tali operazioni o ricreare campagne lunghe rinviate. Un’assenza di capability è un esito osservabile, non un successo simulato.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In 12 job fixture su tre progetti nessun limite configurato è superato e ogni progetto idoneo ottiene un turno prima del secondo turno di un altro.
- **SC-002**: In tutte le prove con quota ignota o costo mancante non avvengono inferenze o cambi provider impliciti.
- **SC-003**: Dieci recovery del punto reservation/start non duplicano run né liberano risorse di processi incerti.
- **SC-004**: Ogni switch autorizzato conserva checkpoint e storia e avvia il sostituto solo dopo prova di cessazione locale del precedente.

## Assumptions

- Destinatario: singolo utente locale che gestisce più progetti, con gli stessi confini di fiducia e prima piattaforma della base Maestro.
- 009 runtime/checkpoint e capability;007 install/validation jobs. Discovery004 integrata solo come consumer del budget, con limite1 e policy readonly invariati.
- Ambito: Coda persistente, concorrenza e risorse, pause/resume programmato, sticky/fallback/cost-aware con checkpoint e policy esplicite; CLI e desktop. Esclusioni: Nessun provider extra non qualificato, previsione inventata di quote/prezzi/reset, cron distribuito, autoscaling cloud o benchmark di lunga durata.
- Gli esempi fixture permettono verifica locale dei comportamenti; non sostituiscono qualifica provider, autorizzazioni reali o approvazione di prodotto.
- I criteri quantitativi sono target della futura implementazione, non misure già raggiunte; non richiedono campagne di volume/durata.
