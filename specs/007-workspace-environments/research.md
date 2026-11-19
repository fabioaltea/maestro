# Research — Workspace Environments & Dependencies

**Data**: 2026-11-19 · Ricerca documentale e codice locale; nessuna qualifica runtime eseguita.

## R1 — Rilevamento senza eseguire config

- **Decision**: Rilevamento senza eseguire config.
- **Rationale**: Leggere manifest/lockfile come dati bounded; config hook eseguibile blocca il default finché non approvata.
- **Alternatives considered**: Lanciare package manager per scoprire il progetto.

## R2 — Isolamento dipendenze mutabili

- **Decision**: Isolamento dipendenze mutabili.
- **Rationale**: Virtual store per worktree e clone/copy dei contenuti; test di modifica in un workspace non altera store o altro workspace.
- **Alternatives considered**: node_modules condiviso o hardlink scrivibili comuni.

## R3 — Frozen e script separati

- **Decision**: Frozen e script separati.
- **Rationale**: Install frozen senza lifecycle script né pnpmfile di default; script/build consentiti solo con un nuovo piano e grant.
- **Alternatives considered**: Considerare --ignore-scripts sufficiente contro ogni hook/config.

## R4 — Pin da qualifica locale

- **Decision**: Pin da qualifica locale.
- **Rationale**: Selezionare versione compatibile con packageManager del progetto e fissare path/hash/versione prima di G0; mismatch rifiutato senza download.
- **Alternatives considered**: Imporre la versione corrente di pnpm o Corepack auto-download.

## R5 — Base e fonti

Decision: integrare la base001–004 implementata senza nuova riscrittura. Fonti: [Constitution](../../.specify/memory/constitution.md), [brief originale](../../docs/product-brief.md), [plan004](../004-project-discovery/plan.md), [provider/runtime004](../004-project-discovery/contracts/provider-runtime.md), [eligibility004](../004-project-discovery/contracts/discovery-api.md), [readiness004](../004-project-discovery/reports/release-readiness.md), `src/ports/provider.ts`, `src/ports/agent-runtime.ts`, `src/domain/discovery/approval.ts`, `src/core/discovery/eligibility.ts`.

Rationale: i tipi ProviderPort attuali sono Discovery-specifici e l’approval storica non è eligibility corrente. Le sorgenti non dimostrano qualifica reale o scrittura sicura. Alternatives considered: duplicare daemon/DB, considerare tutti i test fixture come prova del provider, riaprire automaticamente i benchmark rinviati; respinti.

## R6 — Interfacce, quote e qualifica

Decision: applicare [contratti trasversali](../../docs/missing-features-contracts.md), incluse le fonti primarie Git/pnpm/provider consultate e i limiti dei loro claim. EnvironmentPort e adapter pnpm su binario esterno versionato/hash qualificato; API native Node, nessun package runtime nuovo. Store Maestro condiviso e virtual store per workspace; clone-or-copy dove supportato e provato.

Rationale: le API correnti sul web non certificano il pin installato e il modello di autenticazione. Un dato macchina sconosciuto viene rilevato e confrontato esplicitamente prima dell’uso; assenza o mismatch fallisce chiuso. Alternatives considered: auto-install/aggiornare, importare segreti, capability ottimistiche; respinte.

**Verifica residua, non chiarimenti di design**: G0 pnpm binario reale con registry locale di fixture, zero rete esterna/account: lockfile frozen, hook/config ostili, store mutation isolation e cancel descendant tree. Versione/flag esatti fissati nel report prima di dati reali.

**Conclusione di ricerca**: nessuna scelta di prodotto o architetturale lasciata indefinita. Esiti G0/G1 sono obblighi della futura implementazione, attualmente NOT_RUN; gate precedenti restano BLOCKED.
