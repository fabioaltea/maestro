# Research — Agent Sessions, Runs & Portable Checkpoints

**Data**: 2026-11-19 · Ricerca documentale e codice locale; nessuna qualifica runtime eseguita.

## R1 — Nuovi contratti execution

- **Decision**: Nuovi contratti execution.
- **Rationale**: Il port004 incorpora ArchitectResult e readonly; introdurre port autonomo senza adattare forzatamente il dominio a Codex.
- **Alternatives considered**: Riutilizzo cast del port Discovery.

## R2 — Capacità fail-closed per pin e policy

- **Decision**: Capacità fail-closed per pin e policy.
- **Rationale**: Un eseguibile disponibile non prova write confinement, login o isolamento dei tool; G0/G1 distinti.
- **Alternatives considered**: --dangerously-skip-permissions o bypass sandbox.

## R3 — Comparti provider e comandi

- **Decision**: Comparti provider e comandi.
- **Rationale**: Tool/exec non devono ottenere credenziali o poteri Git del core; se la CLI non consente il confine dimostrato quella capability resta unavailable.
- **Alternatives considered**: Una sandbox identica per provider, comandi arbitrari e helper segreti.

## R4 — Checkpoint core portabile

- **Decision**: Checkpoint core portabile.
- **Rationale**: Facts, diff/commit e validazioni fanno ripartire un nuovo run; native resume opzionale e mai trasferimento automatico di conversazione.
- **Alternatives considered**: Riprendere una conversazione proprietaria come unica fonte di stato.

## R5 — Base e fonti

Decision: integrare la base001–004 implementata senza nuova riscrittura. Fonti: [Constitution](../../.specify/memory/constitution.md), [brief originale](../../docs/product-brief.md), [plan004](../004-project-discovery/plan.md), [provider/runtime004](../004-project-discovery/contracts/provider-runtime.md), [eligibility004](../004-project-discovery/contracts/discovery-api.md), [readiness004](../004-project-discovery/reports/release-readiness.md), `src/ports/provider.ts`, `src/ports/agent-runtime.ts`, `src/domain/discovery/approval.ts`, `src/core/discovery/eligibility.ts`.

Rationale: i tipi ProviderPort attuali sono Discovery-specifici e l’approval storica non è eligibility corrente. Le sorgenti non dimostrano qualifica reale o scrittura sicura. Alternatives considered: duplicare daemon/DB, considerare tutti i test fixture come prova del provider, riaprire automaticamente i benchmark rinviati; respinti.

## R6 — Interfacce, quote e qualifica

Decision: applicare [contratti trasversali](../../docs/missing-features-contracts.md), incluse le fonti primarie Git/pnpm/provider consultate e i limiti dei loro claim. ExecutionProviderPort nuovo distinto dal ProviderPort004; ExecutionRuntimePort e host per-run in policy OS dedicata. Compartment provider/tool/command qualificati prima di accesso a codice reale; event/decoder neutri e niente SDK.

Rationale: le API correnti sul web non certificano il pin installato e il modello di autenticazione. Un dato macchina sconosciuto viene rilevato e confrontato esplicitamente prima dell’uso; assenza o mismatch fallisce chiuso. Alternatives considered: auto-install/aggiornare, importare segreti, capability ottimistiche; respinte.

**Verifica residua, non chiarimenti di design**: G0: binario reale e fixture locale sintetica, catalogo tool/config effettivi, escape `.git`/symlink/credential/child/net e ownership. G1: login ufficiale e feature sintetica opt-in sul profilo qualificato; Codex e Claude hanno esiti separati,003/004 non sono prova di009.

**Conclusione di ricerca**: nessuna scelta di prodotto o architetturale lasciata indefinita. Esiti G0/G1 sono obblighi della futura implementazione, attualmente NOT_RUN; gate precedenti restano BLOCKED.
