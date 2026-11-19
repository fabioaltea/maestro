# Implementation Plan: Feature Planning & Versioned Approval

**Branch**: `005-feature-planning` | **Date**: 2026-11-19 | **Spec**: [spec.md](spec.md)  
**Input**: `/Users/fabioaltea/Repository/maestro/specs/005-feature-planning/spec.md`

## Summary

Dopo Discovery manca un oggetto feature con richiesta, specifica, piano, criteri e approvazione corrente. L’utente deve poter preparare lavoro verificabile senza avviare un agente di implementazione.

Port FeaturePlanningPort separata da ProviderPort Discovery; stessa estrazione readonly e policy004 solo dopo una nuova qualifica dello schema di risultato. Authoring manuale è il primo slice.

004 per projectId, documento approvato ed eligibility attuale. Il percorso reale dipende dalla chiusura del blocco provider004; fixture approvate servono solo nei test. Non dipende009.

## Technical Context

**Language/Version**: TypeScript 6.0.3 strict; Node.js 26.13.0 ESM/NodeNext, pin del checkout.  
**Primary Dependencies**: better-sqlite3 13.0.3 esistente e API native Node; Electron 45.3.0/React19.3.1 come client esistente. Nessun nuovo pacchetto runtime.  
**Storage**: SQLite schema5, stesso writer WAL/FULL; artefatti workflow privati immutabili, ledger e quote da [contratti trasversali](../../docs/missing-features-contracts.md).  
**Testing**: runner Node e Playwright esistenti; unit/contract/local integration senza account/rete; qualifica reale distinta opt-in.  
**Target Platform**: prima piattaforma macOS26.3/26.3.1 arm64/APFS; OS/processi dietro porte e profili qualificati per capability.  
**Project Type**: daemon/CLI con flussi desktop; nessun secondo servizio.  
**Performance Goals**: letture/admission target2s; operazioni lunghe asincrone; limiti specifici sotto, nessuna promessa generale sui provider.  
**Constraints**: Constitution e gate001–004 invariati; Nessun branch/worktree, installazione, implementazione, merge o pubblicazione. Non riutilizzare ArchitectResult come se fosse una specifica feature.  
**Scale/Scope**: Richiesta≤16KiB; bundle≤256KiB;≤50criteri e20domande/turni; generation readonly≤10min, contesto≤30s; quota workflow condivisa.

## Constitution Check

GATE prima della ricerca e dopo il design: PASS indica conformità del progetto documentato; test e qualifica della futura implementazione sono NOT_RUN. Nessuna deroga.

| Principle | Prima ricerca | Dopo design / evidenza richiesta |
|---|---|---|
| I. Local-first | PASS design | PASS design: Stato e artefatti nello stesso archivio; letture offline LAST_KNOWN, nessun effetto da consultazione. |
| II. Headless core | PASS design | PASS design: Servizi nel daemon, CLI/desktop su contratti; ricevute/UUID originali e sessioni indipendenti dal client. |
| III. Provider agnostic | PASS design | PASS design: Manuale sempre senza inferenza; generazione disabilitata se provider non qualificato. Nessun nuovo SDK, API key o fallback per aggirare004. |
| IV. Git safety | PASS design | PASS design: Repository e Git in sola lettura; verificare il contesto Discovery corrente prima di creazione, approvazione e rilascio dell’handoff. |
| V. Recovery | PASS design | PASS design: Ledger workflow, intent/evidence/outcome, CAS revisioni, ownership/generazione e nessun replay cieco; failure path nelle tre storie. |
| VI. Approvals | PASS design | PASS design: Grant core monouso scope/version/digest, invalidazione e azioni distinte; policy automatiche solo se esplicite. |
| VII. Testability | PASS design | PASS design: Porte sostituibili, clock controllato; test locali unit/contract/integration T013–T029, G0 prima delle storie. |
| VIII. Observability | PASS design | PASS design: Outbox metadata, correlazioni, pagine e quote condivise; log/credenziali redatti e stato incerto visibile. |

Non si promuovono gate004/provider reale o001/002/003 a PASS. Se G0 della nuova capability fallisce, fermare le storie dipendenti con BLOCKED; la sola redazione può concludersi. [Brief generale](../../docs/missing-features-brief.md) conserva i debiti originali.

## Project Structure

### Documentation (this feature)

`/Users/fabioaltea/Repository/maestro/specs/005-feature-planning/`: brief.md, spec.md, plan.md, research.md, data-model.md, contracts/api.md, contracts/policy.md, quickstart.md, tasks.md, checklists/requirements.md.

### Source Code (repository root, previsto)

```text
src/domain/features/
src/core/features/
src/ports/feature.ts
src/storage/features-{schema,upgrade,store}.ts
src/protocol/feature.ts
src/cli/feature.ts
apps/desktop/src/main/feature.ts
apps/desktop/src/shared/feature-contract.ts
apps/desktop/src/renderer/views/FeaturePlanning.tsx
tests/{unit,contract,integration}/feature-*.test.ts
apps/desktop/tests/{contract,e2e}/feature-*.test.ts
```

Percorsi proposti precisi e adapter aggiuntivi sono elencati nei task di ciascuna storia; nessun file sorgente è creato nel planning. I path di test fuori parentesi sono reali/proposti rispetto alla root, non directory di un nuovo progetto.

**Structure Decision**: dominio neutro, effetti dietro porte, orchestrazione nello stesso core. Estendere worker/store, dispatcher, client, CLI entrypoint e bridge esistenti; renderer senza OS/SQLite. Port FeaturePlanningPort separata da ProviderPort Discovery; stessa estrazione readonly e policy004 solo dopo una nuova qualifica dello schema di risultato. Authoring manuale è il primo slice.

## Phase 0 — Research

[research.md](research.md) risolve le decisioni di design con alternative e fonti. Parametri dipendenti dalla macchina (hash/pin esterni, login e capacità) sono input di configurazione da verificare nel gate G0/G1, mai capability assunte o chiarimenti di prodotto irrisolti.

## Phase 1 — Design & Contracts

[data-model.md](data-model.md) definisce relazioni, transizioni e invarianti. [contracts/api.md](contracts/api.md) specifica DTO, errori, metodi, confini e comportamento client; eredita [contratti trasversali](../../docs/missing-features-contracts.md). [quickstart.md](quickstart.md) descrive prove future, nessuna eseguita nel planning.

Upgrade 4→5 solo start esplicito, con test schema precedente/read-only/crash e version-check reader/writer. Nessuna riscrittura degli SQL storici né migrazione della vecchia implementazione sperimentale. Le dipendenze funzionali sopra non consentono di saltare i precedenti incrementi di schema.

## Limiti e gate

Richiesta≤16KiB; bundle≤256KiB;≤50criteri e20domande/turni; generation readonly≤10min, contesto≤30s; quota workflow condivisa.

G0: test di confine readonly e schema FeaturePlanningResult con provider sintetico. G1 assistito reale solo dopo004/T028/T050; registrare NOT_RUN/BLOCKED senza impedire la verifica del percorso manuale con fixture.

Gate di rilascio: tre storie con test mirati e flusso desktop, interruzione/cancel e recovery, grant stale/assente, limiti/privacy. Nessuna campagna lunga. La review finale riporta gate esterni distinti e può restare BLOCKED.

## Phase 2 — Confine dei task

Il piano termina qui. La successiva esecuzione richiesta di speckit-tasks produce [tasks.md](tasks.md), organizzato per storia con dipendenze e checkpoint; non esegue i task.

## Complexity Tracking

Nessuna violazione costituzionale. Riuso dei confini della base implementata; nuovi port/ledger sono introdotti solo per gli effetti di questa feature. Le alternative respinte sono motivate in research. Capacità non qualificabili rimangono indisponibili anziché aggirare le policy.
