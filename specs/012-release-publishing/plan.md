# Implementation Plan: Release Publishing, Pull Requests & Deployment Gates

**Branch**: `012-release-publishing` | **Date**: 2026-11-19 | **Spec**: [spec.md](spec.md)  
**Input**: `/Users/fabioaltea/Repository/maestro/specs/012-release-publishing/spec.md`

## Summary

Il merge locale deve poter essere pubblicato e seguito fino a CI e deployment senza confondere azioni e autorizzazioni o ripetere effetti remoti incerti.

GitPublicationPort dietro adapter macOS e RemoteWorkflowPort per PR/CI/deploy. Primo provider hosting qualificabile GitHub con CLI gh esterna pin/hash/auth helper supportati; altri hosting tramite Git-only e handoff manuale, senza nuova dipendenza runtime.

011 IntegrationReceipt corrente e008 Release Manager.010 policy/scheduler per job; senza adapter PR/CI/DEPLOY la capability resta UNSUPPORTED e il push/manual handoff è completo come MVP.

## Technical Context

**Language/Version**: TypeScript 6.0.3 strict; Node.js 26.13.0 ESM/NodeNext, pin del checkout.  
**Primary Dependencies**: better-sqlite3 13.0.3 esistente e API native Node; Electron 45.3.0/React19.3.1 come client esistente. Nessun nuovo pacchetto runtime.  
**Storage**: SQLite schema12, stesso writer WAL/FULL; artefatti workflow privati immutabili, ledger e quote da [contratti trasversali](../../docs/missing-features-contracts.md).  
**Testing**: runner Node e Playwright esistenti; unit/contract/local integration senza account/rete; qualifica reale distinta opt-in.  
**Target Platform**: prima piattaforma macOS26.3/26.3.1 arm64/APFS; OS/processi dietro porte e profili qualificati per capability.  
**Project Type**: daemon/CLI con flussi desktop; nessun secondo servizio.  
**Performance Goals**: letture/admission target2s; operazioni lunghe asincrone; limiti specifici sotto, nessuna promessa generale sui provider.  
**Constraints**: Constitution e gate001–004 invariati; Nessun force push, delete remoto, bypass branch protection, credenziali Maestro copiate, provider CI/CD presunto o deploy automatico non autorizzato.  
**Scale/Scope**: Push/PR/CI request≤60s, deploy≤10min configurable in preview; output cap comuni; max20CIobservations/release in cache metadata latest bounded con storico eventi, no polling quando UI chiusa salvo job follow esplicito; no network from history.

## Constitution Check

GATE prima della ricerca e dopo il design: PASS indica conformità del progetto documentato; test e qualifica della futura implementazione sono NOT_RUN. Nessuna deroga.

| Principle | Prima ricerca | Dopo design / evidenza richiesta |
|---|---|---|
| I. Local-first | PASS design | PASS design: Stato e artefatti nello stesso archivio; letture offline LAST_KNOWN, nessun effetto da consultazione. |
| II. Headless core | PASS design | PASS design: Servizi nel daemon, CLI/desktop su contratti; ricevute/UUID originali e sessioni indipendenti dal client. |
| III. Provider agnostic | PASS design | PASS design: Release Manager suggerisce testo/piano tramite profilo009 autorizzato ma non pubblica dal proprio shell. Git/hosting auth ufficiale è distinta da provider AI e non risolve004. |
| IV. Git safety | PASS design | PASS design: Origin URL canonico e scope verificati prima del consenso; push solo refspec esplicito e commit approvato, no --force, no wildcard, nessun checkout user mutato. Network e credential helper nel solo processo pubblicazione trusted. |
| V. Recovery | PASS design | PASS design: Ledger workflow, intent/evidence/outcome, CAS revisioni, ownership/generazione e nessun replay cieco; failure path nelle tre storie. |
| VI. Approvals | PASS design | PASS design: Grant core monouso scope/version/digest, invalidazione e azioni distinte; policy automatiche solo se esplicite. |
| VII. Testability | PASS design | PASS design: Porte sostituibili, clock controllato; test locali unit/contract/integration T013–T029, G0 prima delle storie. |
| VIII. Observability | PASS design | PASS design: Outbox metadata, correlazioni, pagine e quote condivise; log/credenziali redatti e stato incerto visibile. |

Non si promuovono gate004/provider reale o001/002/003 a PASS. Se G0 della nuova capability fallisce, fermare le storie dipendenti con BLOCKED; la sola redazione può concludersi. [Brief generale](../../docs/missing-features-brief.md) conserva i debiti originali.

## Project Structure

### Documentation (this feature)

`/Users/fabioaltea/Repository/maestro/specs/012-release-publishing/`: brief.md, spec.md, plan.md, research.md, data-model.md, contracts/api.md, contracts/policy.md, quickstart.md, tasks.md, checklists/requirements.md.

### Source Code (repository root, previsto)

```text
src/domain/release/
src/core/release/
src/ports/release.ts
src/storage/release-{schema,upgrade,store}.ts
src/protocol/release.ts
src/cli/release.ts
apps/desktop/src/main/release.ts
apps/desktop/src/shared/release-contract.ts
apps/desktop/src/renderer/views/Releases.tsx
tests/{unit,contract,integration}/release-*.test.ts
apps/desktop/tests/{contract,e2e}/release-*.test.ts
```

Percorsi proposti precisi e adapter aggiuntivi sono elencati nei task di ciascuna storia; nessun file sorgente è creato nel planning. I path di test fuori parentesi sono reali/proposti rispetto alla root, non directory di un nuovo progetto.

**Structure Decision**: dominio neutro, effetti dietro porte, orchestrazione nello stesso core. Estendere worker/store, dispatcher, client, CLI entrypoint e bridge esistenti; renderer senza OS/SQLite. GitPublicationPort dietro adapter macOS e RemoteWorkflowPort per PR/CI/deploy. Primo provider hosting qualificabile GitHub con CLI gh esterna pin/hash/auth helper supportati; altri hosting tramite Git-only e handoff manuale, senza nuova dipendenza runtime.

## Phase 0 — Research

[research.md](research.md) risolve le decisioni di design con alternative e fonti. Parametri dipendenti dalla macchina (hash/pin esterni, login e capacità) sono input di configurazione da verificare nel gate G0/G1, mai capability assunte o chiarimenti di prodotto irrisolti.

## Phase 1 — Design & Contracts

[data-model.md](data-model.md) definisce relazioni, transizioni e invarianti. [contracts/api.md](contracts/api.md) specifica DTO, errori, metodi, confini e comportamento client; eredita [contratti trasversali](../../docs/missing-features-contracts.md). [quickstart.md](quickstart.md) descrive prove future, nessuna eseguita nel planning.

Upgrade 11→12 solo start esplicito, con test schema precedente/read-only/crash e version-check reader/writer. Nessuna riscrittura degli SQL storici né migrazione della vecchia implementazione sperimentale. Le dipendenze funzionali sopra non consentono di saltare i precedenti incrementi di schema.

## Limiti e gate

Push/PR/CI request≤60s, deploy≤10min configurable in preview; output cap comuni; max20CIobservations/release in cache metadata latest bounded con storico eventi, no polling quando UI chiusa salvo job follow esplicito; no network from history.

G0 Git remoto bare locale e hosting/deploy fake: ref races, auth helpers, url schemes/config hooks, response loss, duplicate PR marker, deploy status unknown. G1 remoto reale opt-in per adapter, mai un push automatico durante test ordinari o planning.

Gate di rilascio: tre storie con test mirati e flusso desktop, interruzione/cancel e recovery, grant stale/assente, limiti/privacy. Nessuna campagna lunga. La review finale riporta gate esterni distinti e può restare BLOCKED.

## Phase 2 — Confine dei task

Il piano termina qui. La successiva esecuzione richiesta di speckit-tasks produce [tasks.md](tasks.md), organizzato per storia con dipendenze e checkpoint; non esegue i task.

## Complexity Tracking

Nessuna violazione costituzionale. Riuso dei confini della base implementata; nuovi port/ledger sono introdotti solo per gli effetti di questa feature. Le alternative respinte sono motivate in research. Capacità non qualificabili rimangono indisponibili anziché aggirare le policy.
