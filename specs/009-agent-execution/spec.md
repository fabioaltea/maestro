# Feature Specification: Agent Sessions, Runs & Portable Checkpoints

**Feature Branch**: `009-agent-execution`  
**Created**: 2026-11-19  
**Status**: Draft — verificata documentalmente; approvazione di prodotto e implementazione non implicite.  
**Input**: [brief della feature](brief.md), derivato dalla richiesta di completare le feature mancanti di Maestro e dal [brief generale](../../docs/missing-features-brief.md).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Avviare una sessione di implementazione autorizzata (Priority: P1)

Scegliere un profilo e provider qualificato e lavorare nel workspace previsto.

**Why this priority**: Fornisce il primo risultato utile e verificabile della feature.

**Independent Test**: Con provider locale simulato avviare un run che modifica un file autorizzato; grant stale o tentativi fuori workspace non producono effetti.

**Acceptance Scenarios**:

1. **Given** Piano, workspace, ambiente, profilo e provider correnti, **When** confermo start, **Then** un run posseduto parte con envelope immutabile e scope visibile.
2. **Given** Permesso o capability mancante o input mutato, **When** tento start, **Then** il core blocca prima dello spawn.

---

### User Story 2 - Monitorare e interagire senza dipendere dalla UI (Priority: P1)

Leggere avanzamento, domande e tool request; interrompere o mettere in pausa senza perdere il lavoro.

**Why this priority**: Completa il percorso con un incremento verificabile senza confondere il suo esito con le altre fasi del prodotto.

**Independent Test**: Avviare fixture, chiudere client, rispondere a domanda da CLI e riaprire UI; cancel e timeout conservano output e non dichiarano conclusa una verifica incompleta.

**Acceptance Scenarios**:

1. **Given** Run in corso, **When** chiudo e riapro il client, **Then** run continua e stato/output sono recuperabili.
2. **Given** Agente richiede un tool non autorizzato, **When** leggo richiesta o rispondo, **Then** nessun permesso ampliato; serve nuova autorizzazione scoped o rifiuto.

---

### User Story 3 - Recuperare e riprendere da checkpoint (Priority: P2)

Riconoscere run interrotti e continuare con un nuovo run senza ripetere effetti incerti.

**Why this priority**: Completa il percorso con un incremento verificabile senza confondere il suo esito con le altre fasi del prodotto.

**Independent Test**: Fault in ogni fase start/exit/checkpoint; restart riconcilia ed espone INTERRUPTED o RECONCILING; resume esplicito crea nuova generation e preserva il diff.

**Acceptance Scenarios**:

1. **Given** Run interrotto e uscita provata, **When** confermo resume con checkpoint corrente, **Then** nuovo run con nuovo grant e lavoro precedente conservato.
2. **Given** Processo, checkpoint o filesystem incerto, **When** riavvio o richiedo resume, **Then** blocco e nessuna adozione/terminazione da PID memorizzato.

---

### Edge Cases

- Chiusura/cambio client o archivio: stato autorevole preservato, risposte tardive non applicate ad altro target.
- Retry con UUID originale: stesso intento recupera esito; intento diverso rifiutato senza nuovi effetti.
- Crash prima/dopo un effetto: riconciliare le prove; esito incerto rimane bloccato.
- Input, autorizzazione o contesto cambiati dopo preview: rifiuto e nuova review prima dell’effetto.
- OS boundary reale G0, `.git`/credential escape, grant stale, unknown tool, double writer, crash noGO/GO e pid reuse.
- Client disconnect, output overflow, tool escalation, risposta tardiva, wait-user senza processo, cancel TERM/KILL owned e deadline stop.
- Missing/corrupt artifact, changed tree, process estraneo/unknown, crash checkpoint publication, generation replay, nativeResume unsupported.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Il sistema DEVE richiedere handoff corrente, ambiente dichiarato, workspace posseduto, profilo risolto e consenso relativo all’esatto ambito di esecuzione.
- **FR-002**: Il sistema DEVE esporre capacità effettive per provider e bloccare write/exec se confinamento, autenticazione o tool richiesti non sono qualificati.
- **FR-003**: Il sistema DEVE garantire un solo writer per workspace e una sola admission per richiesta; registrare intento prima di processi o effetti e correlare session/run.
- **FR-004**: Il sistema DEVE conservare output/progress, richieste e risposte con limiti e versioni; consultazione senza UI e offline non avvia lavoro.
- **FR-005**: Il sistema DEVE offrire cancel e pausa come stop controllato con checkpoint e prova di uscita; pausa non promette sospensione nativa del provider.
- **FR-006**: Il sistema DEVE applicare ogni autorizzazione tool nel core e confine runtime; risposta dell’agente o approvazione UI non può allargare una policy.
- **FR-007**: Il sistema DEVE registrare checkpoint portabile con riferimenti a piano, file/commit, validazioni e lavoro restante, distinguendo fatti verificati da note agente.
- **FR-008**: Il sistema DEVE riconciliare processi, workspace ed artefatti prima di liberare lease o creare nuovo run; perdita owner non autorizza ad adottare processi estranei.
- **FR-009**: Il sistema DEVE richiedere un nuovo grant e nuovo run/generation per ripresa o cambio provider, rivalidando ogni input; memoria proprietaria non è un requisito di recovery.
- **FR-010**: Il sistema DEVE esporre le stesse decisioni e gli stessi esiti tramite client headless e desktop; chiusura del client non interrompe lavoro accettato e consultazione offline non avvia effetti.
- **FR-011**: Il sistema DEVE conservare intenzioni, versioni, autorizzazioni ed esiti interrogabili con identità della richiesta, impedendo duplicazioni, effetti senza consenso e riuso di approvazioni obsolete.
- **FR-012**: Il sistema DEVE limitare output e conservazione, rendere visibile saturazione/troncamento e mantenere disponibili consultazione, cancellazione e recovery senza esporre credenziali.

### Key Entities *(include if feature involves data)*

- **ExecutionSession**: Percorso di implementazione di una feature che raccoglie più tentativi e checkpoint.
- **ExecutionRun**: Singolo tentativo di esecuzione con provider, ambito, stato ed esito.
- **ExecutionEnvelope**: Descrizione immutabile del lavoro, del contesto e dei poteri autorizzati per un run.
- **ExecutionProcess**: Identità e prove di appartenenza e uscita del processo supervisionato.
- **PortableCheckpoint**: Stato del lavoro comprensibile a Maestro, con modifiche, prove e attività residue.
- **ExecutionInteraction**: Domanda o richiesta di strumento con risposta e autorizzazione separate.

### Constitutional Invariants & Required Tests *(mandatory)*

- **I / II — Local-first e core headless**: test contract e integrazione locale: leggere stato offline senza provider/rete, chiudere il client durante lavoro accettato, riaprire e recuperare lo stesso esito. Il client non diventa autorità di policy.
- **III — Provider agnostic**: test unitari/contract con capability mancanti, provider assente e risultati invalidi. Ambito: Codex pin004 è un input da riqualificare per write/exec, non un via libera; Claude pin/supporto login da qualificare senza API key implicita. Capabilities per binario/hash/version/auth/policy, nativeResume solo se provato.
- **IV — Git safety**: test integrazione locale con stato dirty/conflitti, identità e operazioni concorrenti pertinenti. Esito sicuro richiesto: Agente scrive solo i file del workspace autorizzato; `.git`, refs/config/hooks e checkout originali non scrivibili. Commit/check di repository sono azioni core con manifest/versione.
- **V — Recovery**: test unitari e integrazione con clock/porte sostituibili, crash pre/post effetto, richiesta duplicata e generazione superata: nessun replay cieco né rilascio di ownership incerta.
- **VI — Approvals**: test unitari/contract/integration con grant assente, stale, di altro ambito/azione e input modificati: nessun effetto e dati conservati.
- **VII — Testability**: tutti i test ordinari del core usano fixture locali e provider simulati senza UI, credenziali reali o servizi esterni; separare test desktop e qualifica reale opt-in.
- **VIII — Observability**: contract e integrazione per correlazioni, redazione, output/quote pieni, troncamento e letture paginabili: errore sicuro e cancel/query/recovery disponibili.
- **Required tests per storia**: i casi US1–US3 ed Edge Cases sono richiesti esplicitamente, con test di transizioni/policy, contratti e integrazione locale prima dell’implementazione pertinente. La parità desktop include conferme, ricevute, tastiera/focus e cambio archivio.
- **Not applicable**: Nessun failover automatico o scheduling avanzato (010), merge/pubblicazione (011/012), terminale PTY libero o promessa di trasferimento memoria conversazionale. Nessun test deve introdurre tali operazioni o ricreare campagne lunghe rinviate. Un’assenza di capability è un esito osservabile, non un successo simulato.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Una feature sintetica autorizzata produce modifiche soltanto nel workspace previsto e un checkpoint ricostruibile.
- **SC-002**: In 10 retry e fault locali non compaiono due writer o run duplicati; l’incertezza conserva il blocco.
- **SC-003**: La chiusura del desktop lascia proseguire la sessione; al riavvio sono visibili stato e output persistiti.
- **SC-004**: Una ripresa da checkpoint in una nuova sessione conserva fatti, lavoro e limiti senza assumere memoria conversazionale condivisa.

## Assumptions

- Destinatario: singolo utente locale che gestisce più progetti, con gli stessi confini di fiducia e prima piattaforma della base Maestro.
- 005 handoff approvato,006 workspace lease,007 ambiente/piano comandi,008 snapshot profilo;004 gate reali restano aperti e non certificano write execution.
- Ambito: Sessioni e run provider-neutral; primo Codex write/exec qualificato; adapter Claude con gate indipendente; output/interazione, checkpoint e ripresa esplicita, CLI e desktop. Esclusioni: Nessun failover automatico o scheduling avanzato (010), merge/pubblicazione (011/012), terminale PTY libero o promessa di trasferimento memoria conversazionale.
- Gli esempi fixture permettono verifica locale dei comportamenti; non sostituiscono qualifica provider, autorizzazioni reali o approvazione di prodotto.
- I criteri quantitativi sono target della futura implementazione, non misure già raggiunte; non richiedono campagne di volume/durata.
