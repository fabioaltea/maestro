# Research — Review, Validation & Safe Local Merge

**Data**: 2026-11-19 · Ricerca documentale e codice locale; nessuna qualifica runtime eseguita.

## R1 — Approvare ciò che viene integrato

- **Decision**: Approvare ciò che viene integrato.
- **Rationale**: Il candidate finale e le prove sul suo tree sono parte della review; target cambiato invalida approvazione.
- **Alternatives considered**: Testare soltanto source prima di un merge che cambia risultato.

## R2 — Target riservato fuori checkout utente

- **Decision**: Target riservato fuori checkout utente.
- **Rationale**: Se branch target è già in uso esterno bloccare e proporre scelta esplicita; guard owned senza force prenota il normale checkout.
- **Alternatives considered**: Merge/reset nel checkout utente dopo un semplice precheck.

## R3 — CAS e recovery a passi

- **Decision**: CAS e recovery a passi.
- **Rationale**: Ledger conserva candidate/old/new ref; crash dopo CAS osserva reachability ed exact proof prima di finalizzare; guard stale non si resetta se cambiato.
- **Alternatives considered**: Ripetere merge dopo timeout o equiparare nuovo HEAD a prova sufficiente.

## R4 — Criteri e doc come evidenze

- **Decision**: Criteri e doc come evidenze.
- **Rationale**: Ogni criterio ha prova o decisione esplicita; blocchi costituzionali non sono derogabili e doc aggiornati entrano nel candidate.
- **Alternatives considered**: All-green dal solo exit0 o dalla frase del provider.

## R5 — Base e fonti

Decision: integrare la base001–004 implementata senza nuova riscrittura. Fonti: [Constitution](../../.specify/memory/constitution.md), [brief originale](../../docs/product-brief.md), [plan004](../004-project-discovery/plan.md), [provider/runtime004](../004-project-discovery/contracts/provider-runtime.md), [eligibility004](../004-project-discovery/contracts/discovery-api.md), [readiness004](../004-project-discovery/reports/release-readiness.md), `src/ports/provider.ts`, `src/ports/agent-runtime.ts`, `src/domain/discovery/approval.ts`, `src/core/discovery/eligibility.ts`.

Rationale: i tipi ProviderPort attuali sono Discovery-specifici e l’approval storica non è eligibility corrente. Le sorgenti non dimostrano qualifica reale o scrittura sicura. Alternatives considered: duplicare daemon/DB, considerare tutti i test fixture come prova del provider, riaprire automaticamente i benchmark rinviati; respinti.

## R6 — Interfacce, quote e qualifica

Decision: applicare [contratti trasversali](../../docs/missing-features-contracts.md), incluse le fonti primarie Git/pnpm/provider consultate e i limiti dei loro claim. ReviewSnapshot dal core, EnvironmentJobPort per check, ReviewPort per lettura diff/test e GitIntegrationPort per candidate/CAS; nessun SDK o motore di merge esterno.

Rationale: le API correnti sul web non certificano il pin installato e il modello di autenticazione. Un dato macchina sconosciuto viene rilevato e confrontato esplicitamente prima dell’uso; assenza o mismatch fallisce chiuso. Alternatives considered: auto-install/aggiornare, importare segreti, capability ottimistiche; respinte.

**Verifica residua, non chiarimenti di design**: Fixture Git reali clean/dirty/ignored/conflict/target movement e hook ostili, fault pre/post CAS e guard sync; nessun merge nel repository Maestro durante planning. Le interferenze arbitrarie same-UID/--force restano fuori dalla prenotazione ordinaria, mai una promessa di isolamento Git.

**Conclusione di ricerca**: nessuna scelta di prodotto o architetturale lasciata indefinita. Esiti G0/G1 sono obblighi della futura implementazione, attualmente NOT_RUN; gate precedenti restano BLOCKED.
