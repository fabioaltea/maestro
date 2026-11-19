# Feature Specification: Workspace Environments & Dependencies

**Feature Branch**: `007-workspace-environments`
**Created**: 2026-11-19
**Status**: Draft — verificata documentalmente; approvazione di prodotto e implementazione non implicite.
**Input**: [brief della feature](brief.md), derivato dalla richiesta di completare le feature mancanti di Maestro e dal [brief generale](../../docs/missing-features-brief.md).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Rilevare e approvare il piano d’ambiente (Priority: P1)

Vedere manager, input, script/config rischiosi, rete e costi locali prima dell’installazione.

**Why this priority**: Fornisce il primo risultato utile e verificabile della feature.

**Independent Test**: Su repository pnpm/npm/ambiguo leggere manifest e produrre PLANNED o MANUAL_REQUIRED senza spawn né modifica.

**Acceptance Scenarios**:

1. **Given** Workspace posseduto con lockfile pnpm coerente, **When** analizzo l’ambiente, **Then** ottengo piano con pin/config/script/rete/limiti.
2. **Given** Manager assente o config eseguibile non autorizzata, **When** richiedo piano, **Then** stato manuale/bloccato con motivo e nessuna esecuzione.

---

### User Story 2 - Preparare dipendenze isolate (Priority: P1)

Avviare installazione qualificata e verificare che il workspace diventi pronto solo per gli input esatti.

**Why this priority**: Completa il percorso con un incremento verificabile senza confondere il suo esito con le altre fasi del prodotto.

**Independent Test**: Registry locale e due workspace: installare, modificare un pacchetto in uno, verificare l’altro e store invariati; poi cambiare lock e controllare STALE.

**Acceptance Scenarios**:

1. **Given** Piano corrente e grant install, **When** avvio e ripeto richiesta, **Then** un job installa senza aggiornare lockfile e produce prova READY.
2. **Given** Lock/config cambia o quota disco viene superata, **When** job è in corso, **Then** cancel posseduto e stato STALE/FAILED senza falsa prontezza.

---

### User Story 3 - Eseguire controlli e recuperare i job (Priority: P2)

Lanciare comandi di validazione approvati, leggere risultati ed esplicitare recovery/manualità.

**Why this priority**: Completa il percorso con un incremento verificabile senza confondere il suo esito con le altre fasi del prodotto.

**Independent Test**: Con CommandSpec fixture eseguire check con esito0/nonzero/timeout; restart a metà non ripete il comando e conserva output e prova input.

**Acceptance Scenarios**:

1. **Given** Ambiente corrente e comando tipizzato approvato, **When** avvio validazione, **Then** esito e output sono legati agli input e non dichiarano review riuscita da soli.
2. **Given** Crash o processo non identificabile, **When** riavvio, **Then** job RECONCILING conserva lease e non avvia un duplicato.

---

### Edge Cases

- Chiusura/cambio client o archivio: stato autorevole preservato, risposte tardive non applicate ad altro target.
- Retry con UUID originale: stesso intento recupera esito; intento diverso rifiutato senza nuovi effetti.
- Crash prima/dopo un effetto: riconciliare le prove; esito incerto rimane bloccato.
- Input, autorizzazione o contesto cambiati dopo preview: rifiuto e nuova review prima dell’effetto.
- Lockfile multipli, version mismatch, file link/speciale, .pnpmfile e config globali, attestation stale.
- Frozen failure, isolamento store clone/copy, no hook inatteso, rete negata, descendant process, disk cap, crash pre/post spawn.
- Exit0 con output tronco/incomplete proof, timeout, restart, processo estraneo, comando contiene shell metacaratteri trattati come argv, cleanup referenced.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Il sistema DEVE rilevare stack e package manager dai soli dati statici, distinguendo supportato, ambiguo e manuale senza conversioni automatiche.
- **FR-002**: Il sistema DEVE produrre piano immutabile legato a input, binario, policy di script/rete, store e budget prima di ottenere consenso.
- **FR-003**: Il sistema DEVE consentire setup manuale dichiarato con attestazione e limiti visibili, senza equipararlo a una qualifica automatica.
- **FR-004**: Il sistema DEVE avviare una sola preparazione per workspace con consenso su rete e script; condividere soltanto contenuti compatibili senza directory mutabili comuni.
- **FR-005**: Il sistema DEVE non modificare manifest o lockfile nella modalità frozen; input cambiati invalidano la preparazione e richiedono nuovo piano.
- **FR-006**: Il sistema DEVE applicare limiti di disco, tempo/output e concorrenza, preservando dati esistenti e offrendo cancel con prova di uscita.
- **FR-007**: Il sistema DEVE eseguire solo comandi dichiarati nel piano con argv, cwd, rete e ambiente limitati, senza shell libera dal client.
- **FR-008**: Il sistema DEVE conservare esiti, codice uscita, inputDigest e output bounded anche offline; distinguere controllo fallito, incompleto e non eseguito.
- **FR-009**: Il sistema DEVE riconciliare job e processo prima di liberare lease; la rimozione di cache/ambiente deve essere esplicita e confinata a risorse possedute non referenziate.
- **FR-010**: Il sistema DEVE esporre le stesse decisioni e gli stessi esiti tramite client headless e desktop; chiusura del client non interrompe lavoro accettato e consultazione offline non avvia effetti.
- **FR-011**: Il sistema DEVE conservare intenzioni, versioni, autorizzazioni ed esiti interrogabili con identità della richiesta, impedendo duplicazioni, effetti senza consenso e riuso di approvazioni obsolete.
- **FR-012**: Il sistema DEVE limitare output e conservazione, rendere visibile saturazione/troncamento e mantenere disponibili consultazione, cancellazione e recovery senza esporre credenziali.

### Key Entities *(include if feature involves data)*

- **EnvironmentPlan**: Descrizione approvabile di dipendenze, comandi, rete, script e limiti.
- **EnvironmentInstance**: Preparazione del workspace riferita agli esatti input del piano.
- **EnvironmentJob**: Installazione o controllo con stato, uscita e output osservabili.
- **EnvironmentAttestation**: Dichiarazione di setup manuale con provenienza e limitazioni visibili.

### Constitutional Invariants & Required Tests *(mandatory)*

- **I / II — Local-first e core headless**: test contract e integrazione locale: leggere stato offline senza provider/rete, chiudere il client durante lavoro accettato, riaprire e recuperare lo stesso esito. Il client non diventa autorità di policy.
- **III — Provider agnostic**: test unitari/contract con capability mancanti, provider assente e risultati invalidi. Ambito: Nessun provider; script/installazioni sono esecuzione di codice con autorizzazione distinta dal piano feature.
- **IV — Git safety**: test integrazione locale con stato dirty/conflitti, identità e operazioni concorrenti pertinenti. Esito sicuro richiesto: Preparazione scrive solo workspace posseduto e store dedicato; lockfile e manifest restano invariati in modalità frozen; niente Git mutations.
- **V — Recovery**: test unitari e integrazione con clock/porte sostituibili, crash pre/post effetto, richiesta duplicata e generazione superata: nessun replay cieco né rilascio di ownership incerta.
- **VI — Approvals**: test unitari/contract/integration con grant assente, stale, di altro ambito/azione e input modificati: nessun effetto e dati conservati.
- **VII — Testability**: tutti i test ordinari del core usano fixture locali e provider simulati senza UI, credenziali reali o servizi esterni; separare test desktop e qualifica reale opt-in.
- **VIII — Observability**: contract e integrazione per correlazioni, redazione, output/quote pieni, troncamento e letture paginabili: errore sicuro e cancel/query/recovery disponibili.
- **Required tests per storia**: i casi US1–US3 ed Edge Cases sono richiesti esplicitamente, con test di transizioni/policy, contratti e integrazione locale prima dell’implementazione pertinente. La parità desktop include conferme, ricevute, tastiera/focus e cambio archivio.
- **Not applicable**: Nessuna conversione automatica npm/yarn→pnpm, installazione globale/auto-update, terminale libero, pruning store globale o sofisticata build cache. Nessun test deve introdurre tali operazioni o ricreare campagne lunghe rinviate. Un’assenza di capability è un esito osservabile, non un successo simulato.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Due workspace con lockfile differenti completano la preparazione fixture mantenendo dipendenze logicamente indipendenti.
- **SC-002**: In tutte le prove frozen, lockfile e manifest restano identici e una variazione rende l’ambiente non pronto.
- **SC-003**: In 10 retry/interruzioni non si avviano due installazioni sullo stesso workspace e il job incerto resta osservabile.
- **SC-004**: Nessuno script o accesso di rete non autorizzato viene eseguito nei casi negativi di qualifica.

## Assumptions

- Destinatario: singolo utente locale che gestisce più progetti, con gli stessi confini di fiducia e prima piattaforma della base Maestro.
- 006 per workspace/ownership/lease.007 non dipende009: host job ambiente e provider runtime sono porte distinte;008 usa la capability EnvironmentJob successivamente.
- Ambito: Rilevamento statico, piano d’ambiente, preparazione pnpm autorizzata, stato e job di validazione controllati; percorso manuale esplicito per altri ecosistemi. Esclusioni: Nessuna conversione automatica npm/yarn→pnpm, installazione globale/auto-update, terminale libero, pruning store globale o sofisticata build cache.
- Gli esempi fixture permettono verifica locale dei comportamenti; non sostituiscono qualifica provider, autorizzazioni reali o approvazione di prodotto.
- I criteri quantitativi sono target della futura implementazione, non misure già raggiunte; non richiedono campagne di volume/durata.
