# Feature Specification: Agent Profiles, Skills & Tools

**Feature Branch**: `008-agent-profiles`  
**Created**: 2026-11-19  
**Status**: Draft — verificata documentalmente; approvazione di prodotto e implementazione non implicite.  
**Input**: [brief della feature](brief.md), derivato dalla richiesta di completare le feature mancanti di Maestro e dal [brief generale](../../docs/missing-features-brief.md).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Definire e scegliere profili versionati (Priority: P1)

Creare ruoli riusabili e vedere cosa riceverà l’agente prima di avviarlo.

**Why this priority**: Fornisce il primo risultato utile e verificabile della feature.

**Independent Test**: Creare seed Project Architect/Frontend/Backend/QA/Reviewer/Release Manager come dati, risolvere uno e modificare il profilo verificando lo snapshot storico.

**Acceptance Scenarios**:

1. **Given** Registry locale disponibile, **When** scelgo un profilo, **Then** vedo provider preferiti, istruzioni, validazioni e limiti.
2. **Given** Profilo modificato o disabilitato, **When** riapro una vecchia risoluzione, **Then** la storia resta leggibile e l’uso corrente è rivalidato.

---

### User Story 2 - Importare e associare skill con provenienza (Priority: P1)

Usare skill locali globali, di progetto e di profilo distinguendo obbligatorie e consigliate.

**Why this priority**: Completa il percorso con un incremento verificabile senza confondere il suo esito con le altre fasi del prodotto.

**Independent Test**: Importare SKILL.md fixture di tre scope, associare required/recommended, provare alias conflittuale e file sostituito senza eseguire il contenuto.

**Acceptance Scenarios**:

1. **Given** Bundle locale e provenienza visibile, **When** approvo import e associazione, **Then** una revisione immutabile entra nel registry.
2. **Given** Skill required assente o digest mutato, **When** risolvo il profilo, **Then** blocco esplicito senza download o sostituzione silenziosa.

---

### User Story 3 - Configurare tool e permessi senza escalation (Priority: P2)

Abilitare tool dichiarati e vedere suggerimenti compatibili senza avviarli o concedere più diritti.

**Why this priority**: Completa il percorso con un incremento verificabile senza confondere il suo esito con le altre fasi del prodotto.

**Independent Test**: Importare ToolManifest locale e MCP fixture, negare capability, revocare tool e controllare che009 riceverebbe solo lo snapshot autorizzato.

**Acceptance Scenarios**:

1. **Given** Tool con manifest e sorgente verificabili, **When** confermo configurazione, **Then** tool ENABLED come configurazione, con scope limitato.
2. **Given** Tool chiede permessi oltre policy o profilo, **When** risolvo o applico suggerimento, **Then** rifiuto e nessuna installazione/esecuzione automatica.

---

### Edge Cases

- Chiusura/cambio client o archivio: stato autorevole preservato, risposte tardive non applicate ad altro target.
- Retry con UUID originale: stesso intento recupera esito; intento diverso rifiutato senza nuovi effetti.
- Crash prima/dopo un effetto: riconciliare le prove; esito incerto rimane bloccato.
- Input, autorizzazione o contesto cambiati dopo preview: rifiuto e nuova review prima dell’effetto.
- Seed senza runtime, capability unknown, disabilitazione mentre snapshot in uso, replica risoluzione e escalation da prompt.
- Symlink e traversal, cambio source dopo preview, alias ambiguo, missing required, overflow e testo che chiede permessi.
- Scope widening, deny precedence, credential leakage, manifest executable substitution, revoca durante run e suggerimento senza install.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Il sistema DEVE fornire sei ruoli iniziali modificabili come revisioni di dati e mantenere Project Architect Discovery soggetto alla policy readonly004.
- **FR-002**: Il sistema DEVE consentire creazione, revisione, scelta e disabilitazione dei profili senza cambiare snapshot in uso.
- **FR-003**: Il sistema DEVE risolvere un profilo con revisioni esatte e permessi effettivi visibili, bloccando capability mancanti o sconosciute.
- **FR-004**: Il sistema DEVE importare skill solo dopo preview di sorgente, hash, scope e requisiti; nessuna esecuzione o installazione transitiva implicita.
- **FR-005**: Il sistema DEVE distinguere skill obbligatorie e raccomandate e applicare precedenza esplicita tra scope senza collisioni silenziose.
- **FR-006**: Il sistema DEVE mostrare e conservare provenienza/revisioni e invalidare le risoluzioni se le dipendenze cambiano o sono revocate.
- **FR-007**: Il sistema DEVE registrare tool con manifest, provenienza, capability e scope; separare import, enable, credenziali e avvio runtime.
- **FR-008**: Il sistema DEVE calcolare permessi effettivi per intersezione dei grant e unione dei deny; conflitti/mandatory non soddisfatti impediscono l’avvio.
- **FR-009**: Il sistema DEVE suggerire solo skill/tool compatibili mostrando motivazione, senza auto-installazione; supportare revoca e invalidazione delle autorizzazioni future.
- **FR-010**: Il sistema DEVE esporre le stesse decisioni e gli stessi esiti tramite client headless e desktop; chiusura del client non interrompe lavoro accettato e consultazione offline non avvia effetti.
- **FR-011**: Il sistema DEVE conservare intenzioni, versioni, autorizzazioni ed esiti interrogabili con identità della richiesta, impedendo duplicazioni, effetti senza consenso e riuso di approvazioni obsolete.
- **FR-012**: Il sistema DEVE limitare output e conservazione, rendere visibile saturazione/troncamento e mantenere disponibili consultazione, cancellazione e recovery senza esporre credenziali.

### Key Entities *(include if feature involves data)*

- **AgentProfileRevision**: Versione di un ruolo con istruzioni, preferenze, skill, tool e permessi.
- **SkillRevision**: Istruzioni riusabili con versione, provenienza, ambito e requisiti dichiarati.
- **ToolRevision**: Configurazione versionata di uno strumento e dei permessi che richiede.
- **ResolvedProfile**: Composizione immutabile delle versioni e dei permessi effettivamente concessi.
- **ExtensionApproval**: Consenso a importare o abilitare una precisa estensione in uno scope.

### Constitutional Invariants & Required Tests *(mandatory)*

- **I / II — Local-first e core headless**: test contract e integrazione locale: leggere stato offline senza provider/rete, chiudere il client durante lavoro accettato, riaprire e recuperare lo stesso esito. Il client non diventa autorità di policy.
- **III — Provider agnostic**: test unitari/contract con capability mancanti, provider assente e risultati invalidi. Ambito: Provider preferences e fallback sono desideri, non capability; resolver interseca permessi core, progetto, profilo, skill/tool e adapter qualificato. Nessuna autenticazione provider durante lettura.
- **IV — Git safety**: test integrazione locale con stato dirty/conflitti, identità e operazioni concorrenti pertinenti. Esito sicuro richiesto: Import/riferimenti progetto in sola lettura; nessuna scrittura di AGENTS.md/CLAUDE.md/config provider nel checkout o Git mutations.
- **V — Recovery**: test unitari e integrazione con clock/porte sostituibili, crash pre/post effetto, richiesta duplicata e generazione superata: nessun replay cieco né rilascio di ownership incerta.
- **VI — Approvals**: test unitari/contract/integration con grant assente, stale, di altro ambito/azione e input modificati: nessun effetto e dati conservati.
- **VII — Testability**: tutti i test ordinari del core usano fixture locali e provider simulati senza UI, credenziali reali o servizi esterni; separare test desktop e qualifica reale opt-in.
- **VIII — Observability**: contract e integrazione per correlazioni, redazione, output/quote pieni, troncamento e letture paginabili: errore sicuro e cancel/query/recovery disponibili.
- **Required tests per storia**: i casi US1–US3 ed Edge Cases sono richiesti esplicitamente, con test di transizioni/policy, contratti e integrazione locale prima dell’implementazione pertinente. La parità desktop include conferme, ricevute, tastiera/focus e cambio archivio.
- **Not applicable**: Nessun marketplace pubblico, download automatico, esecuzione skill/tool durante import, credenziali nel registry o ampliamento permessi tramite testo. Nessun test deve introdurre tali operazioni o ricreare campagne lunghe rinviate. Un’assenza di capability è un esito osservabile, non un successo simulato.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: I sei ruoli iniziali sono risolvibili senza rete e con elenco esatto di istruzioni, skill, tool e permessi.
- **SC-002**: In tutte le combinazioni di conflitto provate, una skill non amplia i permessi concessi e un requisito mancante blocca la risoluzione.
- **SC-003**: Due risoluzioni degli stessi input producono lo stesso contenuto identificato; una modifica rilevante rende il precedente snapshot non corrente.
- **SC-004**: Nessun import, preview o lettura avvia eseguibili, hook o connessioni ai tool.

## Assumptions

- Destinatario: singolo utente locale che gestisce più progetti, con gli stessi confini di fiducia e prima piattaforma della base Maestro.
- 004 per Project Architect esistente e progetti;007 come baseline schema cumulativa.009 consumer futuro del profilo risolto, non prerequisito.
- Ambito: Registry locale versionato globale/progetto/profilo; sei ruoli iniziali; import skill SKILL.md e tool manifest; risoluzione e consenso su install/config locale. Esclusioni: Nessun marketplace pubblico, download automatico, esecuzione skill/tool durante import, credenziali nel registry o ampliamento permessi tramite testo.
- Gli esempi fixture permettono verifica locale dei comportamenti; non sostituiscono qualifica provider, autorizzazioni reali o approvazione di prodotto.
- I criteri quantitativi sono target della futura implementazione, non misure già raggiunte; non richiedono campagne di volume/durata.
