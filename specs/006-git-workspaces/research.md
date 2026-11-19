# Research — Owned Git Workspaces

**Data**: 2026-11-19 · Ricerca documentale e codice locale; nessuna qualifica runtime eseguita.

## R1 — Branch da OID esatto

- **Decision**: Branch da OID esatto.
- **Rationale**: Salvare baseRef+baseOid risolti e grant; movimento della base prima dell’effetto richiede nuova approvazione.
- **Alternatives considered**: Usare HEAD implicito al momento dello spawn.

## R2 — Proprietà con prove multiple

- **Decision**: Proprietà con prove multiple.
- **Rationale**: Root privata, anchor, marker e worktree list devono concordare prima di riuso/rimozione.
- **Alternatives considered**: Fidarsi del path o del solo nome branch.

## R3 — Cleanup conservativo

- **Decision**: Cleanup conservativo.
- **Rationale**: 006 rimuove solo workspace clean con HEAD integrato provato nel target corrente; se011 manca conserva il workspace.
- **Alternatives considered**: --force o considerare clean equivalente a integrato.

## R4 — Mutatore separato dall’ispezione

- **Decision**: Mutatore separato dall’ispezione.
- **Rationale**: La policy readonly002 resta invariata; G0 qualifica l’allowlist mutativa su fixture.
- **Alternatives considered**: Allargare senza controllo il profilo ispettore esistente.

## R5 — Base e fonti

Decision: integrare la base001–004 implementata senza nuova riscrittura. Fonti: [Constitution](../../.specify/memory/constitution.md), [brief originale](../../docs/product-brief.md), [plan004](../004-project-discovery/plan.md), [provider/runtime004](../004-project-discovery/contracts/provider-runtime.md), [eligibility004](../004-project-discovery/contracts/discovery-api.md), [readiness004](../004-project-discovery/reports/release-readiness.md), `src/ports/provider.ts`, `src/ports/agent-runtime.ts`, `src/domain/discovery/approval.ts`, `src/core/discovery/eligibility.ts`.

Rationale: i tipi ProviderPort attuali sono Discovery-specifici e l’approval storica non è eligibility corrente. Le sorgenti non dimostrano qualifica reale o scrittura sicura. Alternatives considered: duplicare daemon/DB, considerare tutti i test fixture come prova del provider, riaprire automaticamente i benchmark rinviati; respinti.

## R6 — Interfacce, quote e qualifica

Decision: applicare [contratti trasversali](../../docs/missing-features-contracts.md), incluse le fonti primarie Git/pnpm/provider consultate e i limiti dei loro claim. Adapter Git mutativo nuovo dietro WorkspacePort, separato da repository-inspector readonly; binario Git Xcode pin del repository, argv allowlist, shell:false e profilo OS qualificato per le sole risorse possedute.

Rationale: le API correnti sul web non certificano il pin installato e il modello di autenticazione. Un dato macchina sconosciuto viene rilevato e confrontato esplicitamente prima dell’uso; assenza o mismatch fallisce chiuso. Alternatives considered: auto-install/aggiornare, importare segreti, capability ottimistiche; respinte.

**Verifica residua, non chiarimenti di design**: G0 locale con Git reale su repository temporanei, hook/config ostili, path/symlink sostituiti e crash pre/post worktree add; niente repository utente modificato nel planning.

**Conclusione di ricerca**: nessuna scelta di prodotto o architetturale lasciata indefinita. Esiti G0/G1 sono obblighi della futura implementazione, attualmente NOT_RUN; gate precedenti restano BLOCKED.
