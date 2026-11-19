# Implementation Plan: Agent Sessions, Runs & Portable Checkpoints

**Branch**: `009-agent-execution` | **Date**: 2026-11-19 | **Spec**: [spec.md](spec.md)  
**Input**: `/Users/fabioaltea/Repository/maestro/specs/009-agent-execution/spec.md`

## Summary

Manca l’implementazione di una feature in un workspace con run supervisionati e stato recuperabile indipendente dalla UI.

ExecutionProviderPort nuovo distinto dal ProviderPort004; ExecutionRuntimePort e host per-run in policy OS dedicata. Compartment provider/tool/command qualificati prima di accesso a codice reale; event/decoder neutri e niente SDK.

005 handoff approvato,006 workspace lease,007 ambiente/piano comandi,008 snapshot profilo;004 gate reali restano aperti e non certificano write execution.

## Technical Context

**Language/Version**: TypeScript 6.0.3 strict; Node.js 26.13.0 ESM/NodeNext, pin del checkout.  
**Primary Dependencies**: better-sqlite3 13.0.3 esistente e API native Node; Electron 45.3.0/React19.3.1 come client esistente. Nessun nuovo pacchetto runtime.  
**Storage**: SQLite schema9, stesso writer WAL/FULL; artefatti workflow privati immutabili, ledger e quote da [contratti trasversali](../../docs/missing-features-contracts.md).  
**Testing**: runner Node e Playwright esistenti; unit/contract/local integration senza account/rete; qualifica reale distinta opt-in.  
**Target Platform**: prima piattaforma macOS26.3/26.3.1 arm64/APFS; OS/processi dietro porte e profili qualificati per capability.  
**Project Type**: daemon/CLI con flussi desktop; nessun secondo servizio.  
**Performance Goals**: letture/admission target2s; operazioni lunghe asincrone; limiti specifici sotto, nessuna promessa generale sui provider.  
**Constraints**: Constitution e gate001–004 invariati; Nessun failover automatico o scheduling avanzato (010), merge/pubblicazione (011/012), terminale PTY libero o promessa di trasferimento memoria conversazionale.  
**Scale/Scope**: 1run attivo per daemon prima010; un writer/workspace; run≤30min, input≤2MiB e≤512KiB profilo, output quote comuni;20interazioni/run,4KiB/testo; shutdown entro budget Foundation esistente.

## Constitution Check

GATE prima della ricerca e dopo il design: PASS indica conformità del progetto documentato; test e qualifica della futura implementazione sono NOT_RUN. Nessuna deroga.

| Principle | Prima ricerca | Dopo design / evidenza richiesta |
|---|---|---|
| I. Local-first | PASS design | PASS design: Stato e artefatti nello stesso archivio; letture offline LAST_KNOWN, nessun effetto da consultazione. |
| II. Headless core | PASS design | PASS design: Servizi nel daemon, CLI/desktop su contratti; ricevute/UUID originali e sessioni indipendenti dal client. |
| III. Provider agnostic | PASS design | PASS design: Codex pin004 è un input da riqualificare per write/exec, non un via libera; Claude pin/supporto login da qualificare senza API key implicita. Capabilities per binario/hash/version/auth/policy, nativeResume solo se provato. |
| IV. Git safety | PASS design | PASS design: Agente scrive solo i file del workspace autorizzato; `.git`, refs/config/hooks e checkout originali non scrivibili. Commit/check di repository sono azioni core con manifest/versione. |
| V. Recovery | PASS design | PASS design: Ledger workflow, intent/evidence/outcome, CAS revisioni, ownership/generazione e nessun replay cieco; failure path nelle tre storie. |
| VI. Approvals | PASS design | PASS design: Grant core monouso scope/version/digest, invalidazione e azioni distinte; policy automatiche solo se esplicite. |
| VII. Testability | PASS design | PASS design: Porte sostituibili, clock controllato; test locali unit/contract/integration T013–T029, G0 prima delle storie. |
| VIII. Observability | PASS design | PASS design: Outbox metadata, correlazioni, pagine e quote condivise; log/credenziali redatti e stato incerto visibile. |

Non si promuovono gate004/provider reale o001/002/003 a PASS. Se G0 della nuova capability fallisce, fermare le storie dipendenti con BLOCKED; la sola redazione può concludersi. [Brief generale](../../docs/missing-features-brief.md) conserva i debiti originali.

## Project Structure

### Documentation (this feature)

`/Users/fabioaltea/Repository/maestro/specs/009-agent-execution/`: brief.md, spec.md, plan.md, research.md, data-model.md, contracts/api.md, contracts/policy.md, quickstart.md, tasks.md, checklists/requirements.md.

### Source Code (repository root, previsto)

```text
src/domain/execution/
src/core/execution/
src/ports/execution.ts
src/storage/execution-{schema,upgrade,store}.ts
src/protocol/execution.ts
src/cli/execution.ts
apps/desktop/src/main/execution.ts
apps/desktop/src/shared/execution-contract.ts
apps/desktop/src/renderer/views/Sessions.tsx
tests/{unit,contract,integration}/execution-*.test.ts
apps/desktop/tests/{contract,e2e}/execution-*.test.ts
```

Percorsi proposti precisi e adapter aggiuntivi sono elencati nei task di ciascuna storia; nessun file sorgente è creato nel planning. I path di test fuori parentesi sono reali/proposti rispetto alla root, non directory di un nuovo progetto.

**Structure Decision**: dominio neutro, effetti dietro porte, orchestrazione nello stesso core. Estendere worker/store, dispatcher, client, CLI entrypoint e bridge esistenti; renderer senza OS/SQLite. ExecutionProviderPort nuovo distinto dal ProviderPort004; ExecutionRuntimePort e host per-run in policy OS dedicata. Compartment provider/tool/command qualificati prima di accesso a codice reale; event/decoder neutri e niente SDK.

## Phase 0 — Research

[research.md](research.md) risolve le decisioni di design con alternative e fonti. Parametri dipendenti dalla macchina (hash/pin esterni, login e capacità) sono input di configurazione da verificare nel gate G0/G1, mai capability assunte o chiarimenti di prodotto irrisolti.

## Phase 1 — Design & Contracts

[data-model.md](data-model.md) definisce relazioni, transizioni e invarianti. [contracts/api.md](contracts/api.md) specifica DTO, errori, metodi, confini e comportamento client; eredita [contratti trasversali](../../docs/missing-features-contracts.md). [quickstart.md](quickstart.md) descrive prove future, nessuna eseguita nel planning.

Upgrade 8→9 solo start esplicito, con test schema precedente/read-only/crash e version-check reader/writer. Nessuna riscrittura degli SQL storici né migrazione della vecchia implementazione sperimentale. Le dipendenze funzionali sopra non consentono di saltare i precedenti incrementi di schema.

## Limiti e gate

1run attivo per daemon prima010; un writer/workspace; run≤30min, input≤2MiB e≤512KiB profilo, output quote comuni;20interazioni/run,4KiB/testo; shutdown entro budget Foundation esistente.

G0: binario reale e fixture locale sintetica, catalogo tool/config effettivi, escape `.git`/symlink/credential/child/net e ownership. G1: login ufficiale e feature sintetica opt-in sul profilo qualificato; Codex e Claude hanno esiti separati,003/004 non sono prova di009.

Gate di rilascio: tre storie con test mirati e flusso desktop, interruzione/cancel e recovery, grant stale/assente, limiti/privacy. Nessuna campagna lunga. La review finale riporta gate esterni distinti e può restare BLOCKED.

## Phase 2 — Confine dei task

Il piano termina qui. La successiva esecuzione richiesta di speckit-tasks produce [tasks.md](tasks.md), organizzato per storia con dipendenze e checkpoint; non esegue i task.

## Complexity Tracking

Nessuna violazione costituzionale. Riuso dei confini della base implementata; nuovi port/ledger sono introdotti solo per gli effetti di questa feature. Le alternative respinte sono motivate in research. Capacità non qualificabili rimangono indisponibili anziché aggirare le policy.
