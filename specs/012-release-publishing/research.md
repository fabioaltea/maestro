# Research — Release Publishing, Pull Requests & Deployment Gates

**Data**: 2026-11-19 · Ricerca documentale e codice locale; nessuna qualifica runtime eseguita.

## R1 — Push default manuale e non forzato

- **Decision**: Push default manuale e non forzato.
- **Rationale**: Grant esplicito lega URL/refspec/OID; remote ref osservato e normale push prevengono riscritture. Niente force-with-lease implicito.
- **Alternatives considered**: Push come effetto collaterale del merge o release agente.

## R2 — Unknown remoto è un gate

- **Decision**: Unknown remoto è un gate.
- **Rationale**: Dopo risposta persa verificare ref/PR marker/CI su sorgente; non fare duplicate creation o deploy finché non risolto.
- **Alternatives considered**: Riprovare ogni comando remoto su timeout.

## R3 — Adapter hosting opzionale

- **Decision**: Adapter hosting opzionale.
- **Rationale**: Git-only è un percorso completo con CI/PR/deploy indicati non disponibili; GitHub adapter qualificato senza imporre gh ai repository.
- **Alternatives considered**: Assumere origin GitHub o CI automatica dal nome branch.

## R4 — Deployment separato e policy revocabili

- **Decision**: Deployment separato e policy revocabili.
- **Rationale**: Ambiente, commit/artifact e adapter sono nel grant; automazione opt-in limitata/revocabile, mai ereditata dall’approvazione implementazione.
- **Alternatives considered**: Un singolo approve per merge+push+deploy.

## R5 — Base e fonti

Decision: integrare la base001–004 implementata senza nuova riscrittura. Fonti: [Constitution](../../.specify/memory/constitution.md), [brief originale](../../docs/product-brief.md), [plan004](../004-project-discovery/plan.md), [provider/runtime004](../004-project-discovery/contracts/provider-runtime.md), [eligibility004](../004-project-discovery/contracts/discovery-api.md), [readiness004](../004-project-discovery/reports/release-readiness.md), `src/ports/provider.ts`, `src/ports/agent-runtime.ts`, `src/domain/discovery/approval.ts`, `src/core/discovery/eligibility.ts`.

Rationale: i tipi ProviderPort attuali sono Discovery-specifici e l’approval storica non è eligibility corrente. Le sorgenti non dimostrano qualifica reale o scrittura sicura. Alternatives considered: duplicare daemon/DB, considerare tutti i test fixture come prova del provider, riaprire automaticamente i benchmark rinviati; respinti.

## R6 — Interfacce, quote e qualifica

Decision: applicare [contratti trasversali](../../docs/missing-features-contracts.md), incluse le fonti primarie Git/pnpm/provider consultate e i limiti dei loro claim. GitPublicationPort dietro adapter macOS e RemoteWorkflowPort per PR/CI/deploy. Primo provider hosting qualificabile GitHub con CLI gh esterna pin/hash/auth helper supportati; altri hosting tramite Git-only e handoff manuale, senza nuova dipendenza runtime.

Rationale: le API correnti sul web non certificano il pin installato e il modello di autenticazione. Un dato macchina sconosciuto viene rilevato e confrontato esplicitamente prima dell’uso; assenza o mismatch fallisce chiuso. Alternatives considered: auto-install/aggiornare, importare segreti, capability ottimistiche; respinte.

**Verifica residua, non chiarimenti di design**: G0 Git remoto bare locale e hosting/deploy fake: ref races, auth helpers, url schemes/config hooks, response loss, duplicate PR marker, deploy status unknown. G1 remoto reale opt-in per adapter, mai un push automatico durante test ordinari o planning.

**Conclusione di ricerca**: nessuna scelta di prodotto o architetturale lasciata indefinita. Esiti G0/G1 sono obblighi della futura implementazione, attualmente NOT_RUN; gate precedenti restano BLOCKED.
