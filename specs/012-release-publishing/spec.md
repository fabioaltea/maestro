# Feature Specification: Release Publishing, Pull Requests & Deployment Gates

**Feature Branch**: `012-release-publishing`
**Created**: 2026-11-19
**Status**: Draft — verificata documentalmente; approvazione di prodotto e implementazione non implicite.
**Input**: [brief della feature](brief.md), derivato dalla richiesta di completare le feature mancanti di Maestro e dal [brief generale](../../docs/missing-features-brief.md).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Approvare e pubblicare un commit integrato (Priority: P1)

Preparare un piano e fare push esplicito su origin preservando le protezioni remote.

**Why this priority**: Fornisce il primo risultato utile e verificabile della feature.

**Independent Test**: Remote bare temporaneo, receipt011 fixture e grant PUSH: pubblicare esatto OID, simulare auth/failure/response loss e rifiutare remote mutato.

**Acceptance Scenarios**:

1. **Given** Commit integrato e origin/ref verificati, **When** confermo push del piano, **Then** solo il refspec approvato è pubblicato e provato.
2. **Given** Origin/ref cambiato, branch protetto o risposta persa, **When** tento o riconcilio push, **Then** blocco/UNKNOWN o prova di esito senza force e senza replay cieco.

---

### User Story 2 - Aprire una PR e seguire la CI del commit corretto (Priority: P2)

Usare workflow protetti e vedere prove CI riferite al commit pubblicato, senza presumere che una PR integri o distribuisca.

**Why this priority**: Completa il percorso con un incremento verificabile senza confondere il suo esito con le altre fasi del prodotto.

**Independent Test**: Adapter hosting fixture crea una PR con marker UUID, perde risposta e la ritrova senza duplicarla; CI di commit differente non soddisfa il gate.

**Acceptance Scenarios**:

1. **Given** Modalità PR e adapter qualificato, **When** approvo la creazione e richiedo osservazione, **Then** PR unica e CI collegata all’esatto commit con stato datato.
2. **Given** CI assente/unknown o branch protetto, **When** leggo lo stato, **Then** nessun successo/deployment implicito o bypass delle policy remote.

---

### User Story 3 - Autorizzare deployment e automazioni limitate (Priority: P3)

Decidere separatamente l’ambiente da distribuire e le eventuali policy automatiche.

**Why this priority**: Completa il percorso con un incremento verificabile senza confondere il suo esito con le altre fasi del prodotto.

**Independent Test**: Deploy adapter fake con ambiente revisionato e artifact digest: grantDEPLOY esegue una volta; revoke/race/unknown impediscono retry, nessuna chiamata reale.

**Acceptance Scenarios**:

1. **Given** Artefatto e CI richiesti correnti, ambiente e grant validi, **When** confermo deploy o policy esplicita limitata, **Then** job distribuisce solo scope autorizzato e registra prova.
2. **Given** Ambiente, artefatto o policy cambia o l’esito è incerto, **When** parte un wake o richiedo retry, **Then** blocco e riconciliazione senza nuovo deployment cieco.

---

### Edge Cases

- Chiusura/cambio client o archivio: stato autorevole preservato, risposte tardive non applicate ad altro target.
- Retry con UUID originale: stesso intento recupera esito; intento diverso rifiutato senza nuovi effetti.
- Crash prima/dopo un effetto: riconciliare le prove; esito incerto rimane bloccato.
- Input, autorizzazione o contesto cambiati dopo preview: rifiuto e nuova review prima dell’effetto.
- URL substitution/remote-ext, protected branch, nonfastforward, dirty user checkout unchanged, grant crossaction, response lost pre/post receive e tag collision.
- PR duplicate race/lookup ambiguity, branch protection, CI wrong SHA, stale observation, unsupported hosting e URL credential redaction.
- Grant push usato per deploy, environment race, artifact changed, policy revoke/expiry, remote unknown, duplicate deployment e manual handoff.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Il sistema DEVE produrre piano release con commit integrato, destinatario canonico, refspec, stato remoto osservato e azioni distinte prima del consenso.
- **FR-002**: Il sistema DEVE pubblicare solo ref espliciti e commit approvati con autenticazione supportata; negare force, cancellazione e bypass protezioni.
- **FR-003**: Il sistema DEVE registrare intenzione ed esito remoto e riconciliare risposte perse osservando il destinatario; distinguere effetto provato da ref già presente senza attribuzione.
- **FR-004**: Il sistema DEVE supportare PR su hosting qualificato con base/head/versioni e autorizzazione esplicita; Git-only resta percorso supportato con handoff manuale dichiarato.
- **FR-005**: Il sistema DEVE osservare CI su commit e remote corretti distinguendo pending, riuscito, fallito, assente e ignoto senza riqualificare risultati esterni.
- **FR-006**: Il sistema DEVE rendere creazione PR idempotente tramite marker e lookup; sospendere su ambiguità e mantenere URL/ID sicuri senza segreti.
- **FR-007**: Il sistema DEVE richiedere un grant deployment distinto con ambiente, commit/artefatto, adapter e precondizioni correnti; senza adapter qualificato fornire solo handoff manuale.
- **FR-008**: Il sistema DEVE consentire policy automatiche solo opt-in con scope, limiti/scadenza e revoca, verificati dal core a ogni admission.
- **FR-009**: Il sistema DEVE registrare e osservare esiti deployment; nessun rollback/force/retry distruttivo implicito o successo dedotto dal push/CI.
- **FR-010**: Il sistema DEVE esporre le stesse decisioni e gli stessi esiti tramite client headless e desktop; chiusura del client non interrompe lavoro accettato e consultazione offline non avvia effetti.
- **FR-011**: Il sistema DEVE conservare intenzioni, versioni, autorizzazioni ed esiti interrogabili con identità della richiesta, impedendo duplicazioni, effetti senza consenso e riuso di approvazioni obsolete.
- **FR-012**: Il sistema DEVE limitare output e conservazione, rendere visibile saturazione/troncamento e mantenere disponibili consultazione, cancellazione e recovery senza esporre credenziali.

### Key Entities *(include if feature involves data)*

- **ReleasePlan**: Piano di pubblicazione di un commit integrato verso un destinatario identificato.
- **PublicationGrant**: Consenso a una precisa azione di pubblicazione con ambito e versioni.
- **RemoteEffect**: Intenzione ed evidenze di un effetto remoto, anche quando l’esito rimane incerto.
- **CIObservation**: Risultato datato dei controlli remoti riferito allo specifico commit.
- **DeploymentPlan**: Distribuzione prevista con ambiente, artefatto e precondizioni identificati.
- **AutomaticReleasePolicy**: Autorizzazione automatica limitata, versionata, revocabile e con scadenza.

### Constitutional Invariants & Required Tests *(mandatory)*

- **I / II — Local-first e core headless**: test contract e integrazione locale: leggere stato offline senza provider/rete, chiudere il client durante lavoro accettato, riaprire e recuperare lo stesso esito. Il client non diventa autorità di policy.
- **III — Provider agnostic**: test unitari/contract con capability mancanti, provider assente e risultati invalidi. Ambito: Release Manager suggerisce testo/piano tramite profilo009 autorizzato ma non pubblica dal proprio shell. Git/hosting auth ufficiale è distinta da provider AI e non risolve004.
- **IV — Git safety**: test integrazione locale con stato dirty/conflitti, identità e operazioni concorrenti pertinenti. Esito sicuro richiesto: Origin URL canonico e scope verificati prima del consenso; push solo refspec esplicito e commit approvato, no --force, no wildcard, nessun checkout user mutato. Network e credential helper nel solo processo pubblicazione trusted.
- **V — Recovery**: test unitari e integrazione con clock/porte sostituibili, crash pre/post effetto, richiesta duplicata e generazione superata: nessun replay cieco né rilascio di ownership incerta.
- **VI — Approvals**: test unitari/contract/integration con grant assente, stale, di altro ambito/azione e input modificati: nessun effetto e dati conservati.
- **VII — Testability**: tutti i test ordinari del core usano fixture locali e provider simulati senza UI, credenziali reali o servizi esterni; separare test desktop e qualifica reale opt-in.
- **VIII — Observability**: contract e integrazione per correlazioni, redazione, output/quote pieni, troncamento e letture paginabili: errore sicuro e cancel/query/recovery disponibili.
- **Required tests per storia**: i casi US1–US3 ed Edge Cases sono richiesti esplicitamente, con test di transizioni/policy, contratti e integrazione locale prima dell’implementazione pertinente. La parità desktop include conferme, ricevute, tastiera/focus e cambio archivio.
- **Not applicable**: Nessun force push, delete remoto, bypass branch protection, credenziali Maestro copiate, provider CI/CD presunto o deploy automatico non autorizzato. Nessun test deve introdurre tali operazioni o ricreare campagne lunghe rinviate. Un’assenza di capability è un esito osservabile, non un successo simulato.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Nei 10 scenari locali, integrazione, push, PR/CI e deployment hanno esiti distinti e nessuna pubblicazione avviene con il solo grant merge.
- **SC-002**: Timeout dopo effetto remoto produce riconciliazione o UNKNOWN e nessuna seconda PR/deployment cieca.
- **SC-003**: Un remote/ref/commit o ambiente mutato invalida nel 100% dei casi la precedente autorizzazione.
- **SC-004**: Letture offline mostrano commit e stato remoto datato senza rete, con CI assente/ignota diversa da riuscita.

## Assumptions

- Destinatario: singolo utente locale che gestisce più progetti, con gli stessi confini di fiducia e prima piattaforma della base Maestro.
- 011 IntegrationReceipt corrente e008 Release Manager.010 policy/scheduler per job; senza adapter PR/CI/DEPLOY la capability resta UNSUPPORTED e il push/manual handoff è completo come MVP.
- Ambito: Piano release versionato, push ordinario su origin, tag opzionali approvati, PR e osservazione CI con adapter esplicito, deployment solo per adapter configurato e grant dedicato; CLI e desktop. Esclusioni: Nessun force push, delete remoto, bypass branch protection, credenziali Maestro copiate, provider CI/CD presunto o deploy automatico non autorizzato.
- Gli esempi fixture permettono verifica locale dei comportamenti; non sostituiscono qualifica provider, autorizzazioni reali o approvazione di prodotto.
- I criteri quantitativi sono target della futura implementazione, non misure già raggiunte; non richiedono campagne di volume/durata.
