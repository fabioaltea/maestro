# Implementation Plan: Review, Validation & Safe Local Merge

**Branch**: `011-review-local-merge` | **Date**: 2026-11-19 | **Spec**: [spec.md](spec.md)
**Input**: `/Users/fabioaltea/Repository/maestro/specs/011-review-local-merge/spec.md`

## Summary

L’output dell’agente non dimostra che la feature soddisfi i criteri o possa essere integrata senza perdere lavoro.

ReviewSnapshot dal core, EnvironmentJobPort per check, ReviewPort per lettura diff/test e GitIntegrationPort per candidate/CAS; nessun SDK o motore di merge esterno.

005 piano/criteri correnti,006 ownership e mutatore,007 job validazione,008 Reviewer,009 checkpoint e quiescenza.010 è baseline schema cumulativa; il caso singolo non richiede policy scheduling avanzate.

## Technical Context

**Language/Version**: TypeScript 6.0.3 strict; Node.js 26.13.0 ESM/NodeNext, pin del checkout.
**Primary Dependencies**: better-sqlite3 13.0.3 esistente e API native Node; Electron 45.3.0/React19.3.1 come client esistente. Nessun nuovo pacchetto runtime.
**Storage**: SQLite schema11, stesso writer WAL/FULL; artefatti workflow privati immutabili, ledger e quote da [contratti trasversali](../../docs/missing-features-contracts.md).
**Testing**: runner Node e Playwright esistenti; unit/contract/local integration senza account/rete; qualifica reale distinta opt-in.
**Target Platform**: prima piattaforma macOS26.3/26.3.1 arm64/APFS; OS/processi dietro porte e profili qualificati per capability.
**Project Type**: daemon/CLI con flussi desktop; nessun secondo servizio.
**Performance Goals**: letture/admission target2s; operazioni lunghe asincrone; limiti specifici sotto, nessuna promessa generale sui provider.
**Constraints**: Constitution e gate001–004 invariati; Nessun push, PR o deploy, force/reset/stash checkout utente o risoluzione conflitti automatica. Target in checkout esterno blocca il merge.
**Scale/Scope**: Max100file/2MiB diff visualizzabile per snapshot; eccedenza blocca approvazione finché scope review non coperto; candidate/preflight≤30s, check job≤5min ciascuno; mutation target una per repository.

## Constitution Check

GATE prima della ricerca e dopo il design: PASS indica conformità del progetto documentato; test e qualifica della futura implementazione sono NOT_RUN. Nessuna deroga.

| Principle | Prima ricerca | Dopo design / evidenza richiesta |
|---|---|---|
| I. Local-first | PASS design | PASS design: Stato e artefatti nello stesso archivio; letture offline LAST_KNOWN, nessun effetto da consultazione. |
| II. Headless core | PASS design | PASS design: Servizi nel daemon, CLI/desktop su contratti; ricevute/UUID originali e sessioni indipendenti dal client. |
| III. Provider agnostic | PASS design | PASS design: Reviewer assistito opzionale tramite009 con scope readonly qualificato; commenti AI non conferiscono autorizzazione e non sostituiscono prove dei criteri. |
| IV. Git safety | PASS design | PASS design: Candidate in staging detached posseduto; target deve essere libero e riservato dal guard worktree core. Update-ref con oldOid atteso; niente checkout/merge/reset nel checkout dell’utente. |
| V. Recovery | PASS design | PASS design: Ledger workflow, intent/evidence/outcome, CAS revisioni, ownership/generazione e nessun replay cieco; failure path nelle tre storie. |
| VI. Approvals | PASS design | PASS design: Grant core monouso scope/version/digest, invalidazione e azioni distinte; policy automatiche solo se esplicite. |
| VII. Testability | PASS design | PASS design: Porte sostituibili, clock controllato; test locali unit/contract/integration T013–T029, G0 prima delle storie. |
| VIII. Observability | PASS design | PASS design: Outbox metadata, correlazioni, pagine e quote condivise; log/credenziali redatti e stato incerto visibile. |

Non si promuovono gate004/provider reale o001/002/003 a PASS. Se G0 della nuova capability fallisce, fermare le storie dipendenti con BLOCKED; la sola redazione può concludersi. [Brief generale](../../docs/missing-features-brief.md) conserva i debiti originali.

## Project Structure

### Documentation (this feature)

`/Users/fabioaltea/Repository/maestro/specs/011-review-local-merge/`: brief.md, spec.md, plan.md, research.md, data-model.md, contracts/api.md, contracts/policy.md, quickstart.md, tasks.md, checklists/requirements.md.

### Source Code (repository root, previsto)

```text
src/domain/review/
src/core/review/
src/ports/review.ts
src/storage/review-{schema,upgrade,store}.ts
src/protocol/review.ts
src/cli/review.ts
apps/desktop/src/main/review.ts
apps/desktop/src/shared/review-contract.ts
apps/desktop/src/renderer/views/FeatureReview.tsx
tests/{unit,contract,integration}/review-*.test.ts
apps/desktop/tests/{contract,e2e}/review-*.test.ts
```

Percorsi proposti precisi e adapter aggiuntivi sono elencati nei task di ciascuna storia; nessun file sorgente è creato nel planning. I path di test fuori parentesi sono reali/proposti rispetto alla root, non directory di un nuovo progetto.

**Structure Decision**: dominio neutro, effetti dietro porte, orchestrazione nello stesso core. Estendere worker/store, dispatcher, client, CLI entrypoint e bridge esistenti; renderer senza OS/SQLite. ReviewSnapshot dal core, EnvironmentJobPort per check, ReviewPort per lettura diff/test e GitIntegrationPort per candidate/CAS; nessun SDK o motore di merge esterno.

## Phase 0 — Research

[research.md](research.md) risolve le decisioni di design con alternative e fonti. Parametri dipendenti dalla macchina (hash/pin esterni, login e capacità) sono input di configurazione da verificare nel gate G0/G1, mai capability assunte o chiarimenti di prodotto irrisolti.

## Phase 1 — Design & Contracts

[data-model.md](data-model.md) definisce relazioni, transizioni e invarianti. [contracts/api.md](contracts/api.md) specifica DTO, errori, metodi, confini e comportamento client; eredita [contratti trasversali](../../docs/missing-features-contracts.md). [quickstart.md](quickstart.md) descrive prove future, nessuna eseguita nel planning.

Upgrade 10→11 solo start esplicito, con test schema precedente/read-only/crash e version-check reader/writer. Nessuna riscrittura degli SQL storici né migrazione della vecchia implementazione sperimentale. Le dipendenze funzionali sopra non consentono di saltare i precedenti incrementi di schema.

## Limiti e gate

Max100file/2MiB diff visualizzabile per snapshot; eccedenza blocca approvazione finché scope review non coperto; candidate/preflight≤30s, check job≤5min ciascuno; mutation target una per repository.

Fixture Git reali clean/dirty/ignored/conflict/target movement e hook ostili, fault pre/post CAS e guard sync; nessun merge nel repository Maestro durante planning. Le interferenze arbitrarie same-UID/--force restano fuori dalla prenotazione ordinaria, mai una promessa di isolamento Git.

Gate di rilascio: tre storie con test mirati e flusso desktop, interruzione/cancel e recovery, grant stale/assente, limiti/privacy. Nessuna campagna lunga. La review finale riporta gate esterni distinti e può restare BLOCKED.

## Phase 2 — Confine dei task

Il piano termina qui. La successiva esecuzione richiesta di speckit-tasks produce [tasks.md](tasks.md), organizzato per storia con dipendenze e checkpoint; non esegue i task.

## Complexity Tracking

Nessuna violazione costituzionale. Riuso dei confini della base implementata; nuovi port/ledger sono introdotti solo per gli effetti di questa feature. Le alternative respinte sono motivate in research. Capacità non qualificabili rimangono indisponibili anziché aggirare le policy.
