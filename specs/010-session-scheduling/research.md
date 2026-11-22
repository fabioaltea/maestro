# Research — Session Scheduling, Quotas & Provider Policies

**Data**: 2026-11-19 · Ricerca documentale e codice locale; nessuna qualifica runtime eseguita.

## R1 — Scheduling fair bounded

- **Decision**: Scheduling fair bounded.
- **Rationale**: FIFO per progetto e round-robin tra progetti, priority0..2 esplicita senza preemption di run attivi.
- **Alternatives considered**: Un ciclo polling o first-project-wins.

## R2 — Quote osservate, non indovinate

- **Decision**: Quote osservate, non indovinate.
- **Rationale**: Unknown reset resta null; retry schedulato solo con informazione proveniente da adapter qualificato o orario utente.
- **Alternatives considered**: Assumere finestra di reset o fare probe LLM ripetuti.

## R3 — Switch da checkpoint e consenso

- **Decision**: Switch da checkpoint e consenso.
- **Rationale**: Sospendere/cancellare e provare quiescenza prima di nuovo run; policy bound impedisce invio a provider nuovo non autorizzato.
- **Alternatives considered**: Avviare subito fallback in parallelo al vecchio provider.

## R4 — Cost-aware come dato esplicito

- **Decision**: Cost-aware come dato esplicito.
- **Rationale**: Costo ignoto/non confrontabile blocca scelta automatica e chiede decisione; non richiede API private di fatturazione.
- **Alternatives considered**: Hardcode prezzi o equiparare abbonamento a costo per token.

## R5 — Base e fonti

Decision: integrare la base001–004 implementata senza nuova riscrittura. Fonti: [Constitution](../../.specify/memory/constitution.md), [brief originale](../../docs/product-brief.md), [plan004](../004-project-discovery/plan.md), [provider/runtime004](../004-project-discovery/contracts/provider-runtime.md), [eligibility004](../004-project-discovery/contracts/discovery-api.md), [readiness004](../004-project-discovery/reports/release-readiness.md), `src/ports/provider.ts`, `src/ports/agent-runtime.ts`, `src/domain/discovery/approval.ts`, `src/core/discovery/eligibility.ts`.

Rationale: i tipi ProviderPort attuali sono Discovery-specifici e l’approval storica non è eligibility corrente. Le sorgenti non dimostrano qualifica reale o scrittura sicura. Alternatives considered: duplicare daemon/DB, considerare tutti i test fixture come prova del provider, riaprire automaticamente i benchmark rinviati; respinti.

## R6 — Interfacce, quote e qualifica

Decision: applicare [contratti trasversali](../../docs/missing-features-contracts.md), incluse le fonti primarie Git/pnpm/provider consultate e i limiti dei loro claim. Scheduler nel daemon con clock iniettabile, durable queue e token atomici nel writer; wake timers calcolati dallo stato persistito, nessun poll continuo quando idle.

Rationale: le API correnti sul web non certificano il pin installato e il modello di autenticazione. Un dato macchina sconosciuto viene rilevato e confrontato esplicitamente prima dell’uso; assenza o mismatch fallisce chiuso. Alternatives considered: auto-install/aggiornare, importare segreti, capability ottimistiche; respinte.

**Verifica residua, non chiarimenti di design**: Fixture clock/provider e processi locali brevi; almeno due progetti e quattro job, fault per reservation/spawn/release. Nessuna prova600s, volume1000 o consumo reale necessario al gate locale.

**Conclusione di ricerca**: nessuna scelta di prodotto o architetturale lasciata indefinita. Esiti G0/G1 sono obblighi della futura implementazione, attualmente NOT_RUN; gate precedenti restano BLOCKED.
