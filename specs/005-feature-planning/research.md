# Research — Feature Planning & Versioned Approval

**Data**: 2026-11-19 · Ricerca documentale e codice locale; nessuna qualifica runtime eseguita.

## R1 — Separare authoring da inferenza

- **Decision**: Separare authoring da inferenza.
- **Rationale**: Evita il ciclo005→009→005 e permette valore locale senza provider reale.
- **Alternatives considered**: Obbligare l’inferenza prima di ogni bozza; usare009 in005.

## R2 — Bundle unico immutabile

- **Decision**: Bundle unico immutabile.
- **Rationale**: Specifica e piano approvati insieme con criteri strutturati e provenance CODE/USER/HYPOTHESIS/UNKNOWN.
- **Alternatives considered**: Booleano approved o documenti aggiornabili in-place.

## R3 — Freshness a ogni passaggio

- **Decision**: Freshness a ogni passaggio.
- **Rationale**: Eligibility004 è una fotografia TTL30s, non una capability riusabile. CAS e nuovo controllo prima dell’effetto.
- **Alternatives considered**: Fidarsi di checkId persistito o approval storica.

## R4 — Schema5 e ledger workflow

- **Decision**: Schema5 e ledger workflow.
- **Rationale**: Introducono l’infrastruttura minima comune ai successivi effetti senza cambiare i ledger storici.
- **Alternatives considered**: Un nuovo daemon o duplicazione della persistenza.

## R5 — Base e fonti

Decision: integrare la base001–004 implementata senza nuova riscrittura. Fonti: [Constitution](../../.specify/memory/constitution.md), [brief originale](../../docs/product-brief.md), [plan004](../004-project-discovery/plan.md), [provider/runtime004](../004-project-discovery/contracts/provider-runtime.md), [eligibility004](../004-project-discovery/contracts/discovery-api.md), [readiness004](../004-project-discovery/reports/release-readiness.md), `src/ports/provider.ts`, `src/ports/agent-runtime.ts`, `src/domain/discovery/approval.ts`, `src/core/discovery/eligibility.ts`.

Rationale: i tipi ProviderPort attuali sono Discovery-specifici e l’approval storica non è eligibility corrente. Le sorgenti non dimostrano qualifica reale o scrittura sicura. Alternatives considered: duplicare daemon/DB, considerare tutti i test fixture come prova del provider, riaprire automaticamente i benchmark rinviati; respinti.

## R6 — Interfacce, quote e qualifica

Decision: applicare [contratti trasversali](../../docs/missing-features-contracts.md), incluse le fonti primarie Git/pnpm/provider consultate e i limiti dei loro claim. Port FeaturePlanningPort separata da ProviderPort Discovery; stessa estrazione readonly e policy004 solo dopo una nuova qualifica dello schema di risultato. Authoring manuale è il primo slice.

Rationale: le API correnti sul web non certificano il pin installato e il modello di autenticazione. Un dato macchina sconosciuto viene rilevato e confrontato esplicitamente prima dell’uso; assenza o mismatch fallisce chiuso. Alternatives considered: auto-install/aggiornare, importare segreti, capability ottimistiche; respinte.

**Verifica residua, non chiarimenti di design**: G0: test di confine readonly e schema FeaturePlanningResult con provider sintetico. G1 assistito reale solo dopo004/T028/T050; registrare NOT_RUN/BLOCKED senza impedire la verifica del percorso manuale con fixture.

**Conclusione di ricerca**: nessuna scelta di prodotto o architetturale lasciata indefinita. Esiti G0/G1 sono obblighi della futura implementazione, attualmente NOT_RUN; gate precedenti restano BLOCKED.
