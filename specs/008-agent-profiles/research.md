# Research — Agent Profiles, Skills & Tools

**Data**: 2026-11-19 · Ricerca documentale e codice locale; nessuna qualifica runtime eseguita.

## R1 — Snapshot di risoluzione

- **Decision**: Snapshot di risoluzione.
- **Rationale**: Ogni run consuma revisioni e digest esatti, mai il nome latest da solo.
- **Alternatives considered**: Rileggere skill cambiate durante la sessione.

## R2 — Precedenza esplicita

- **Decision**: Precedenza esplicita.
- **Rationale**: Progetto può selezionare una revisione locale con stesso alias; collisioni non dichiarate falliscono. Required union, deny union e grant intersection non possono ampliare scope.
- **Alternatives considered**: Last-write-wins o merge permissivo.

## R3 — Testo non autorevole

- **Decision**: Testo non autorevole.
- **Rationale**: Istruzioni di skill/profilo non conferiscono capability; permessi derivano dai contratti core.
- **Alternatives considered**: Affidare le policy a prompt o allowTools del provider soltanto.

## R4 — Installazione locale consapevole

- **Decision**: Installazione locale consapevole.
- **Rationale**: Import content-addressed da sorgente dichiarata senza esecuzione; tool start demandato al runtime qualificato009.
- **Alternatives considered**: Install/download/hook impliciti all’apertura del progetto.

## R5 — Base e fonti

Decision: integrare la base001–004 implementata senza nuova riscrittura. Fonti: [Constitution](../../.specify/memory/constitution.md), [brief originale](../../docs/product-brief.md), [plan004](../004-project-discovery/plan.md), [provider/runtime004](../004-project-discovery/contracts/provider-runtime.md), [eligibility004](../004-project-discovery/contracts/discovery-api.md), [readiness004](../004-project-discovery/reports/release-readiness.md), `src/ports/provider.ts`, `src/ports/agent-runtime.ts`, `src/domain/discovery/approval.ts`, `src/core/discovery/eligibility.ts`.

Rationale: i tipi ProviderPort attuali sono Discovery-specifici e l’approval storica non è eligibility corrente. Le sorgenti non dimostrano qualifica reale o scrittura sicura. Alternatives considered: duplicare daemon/DB, considerare tutti i test fixture come prova del provider, riaprire automaticamente i benchmark rinviati; respinti.

## R6 — Interfacce, quote e qualifica

Decision: applicare [contratti trasversali](../../docs/missing-features-contracts.md), incluse le fonti primarie Git/pnpm/provider consultate e i limiti dei loro claim. ProfileResolver puro e registry nello stesso writer; artefatti SKILL.md trattati come testo, ToolManifest tipizzato separato dall’eseguibile. Import locale da bundle regolare con hash/provenienza, niente package parser runtime nuovo.

Rationale: le API correnti sul web non certificano il pin installato e il modello di autenticazione. Un dato macchina sconosciuto viene rilevato e confrontato esplicitamente prima dell’uso; assenza o mismatch fallisce chiuso. Alternatives considered: auto-install/aggiornare, importare segreti, capability ottimistiche; respinte.

**Verifica residua, non chiarimenti di design**: Nessuna inferenza. Qualificare parser/resolver e import con bundle ostili/symlink/overflow; tool runtime reale non è certificato da ENABLED e viene qualificato in009.

**Conclusione di ricerca**: nessuna scelta di prodotto o architetturale lasciata indefinita. Esiti G0/G1 sono obblighi della futura implementazione, attualmente NOT_RUN; gate precedenti restano BLOCKED.
