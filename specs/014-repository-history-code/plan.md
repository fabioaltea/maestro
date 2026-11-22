# Implementation Plan: Storico Git ed esploratore di `main`

**Branch**: `016-repository-history-code` | **Date**: 2026-11-22 | **Spec**: [spec.md](./spec.md)

## Summary

Due viste nella navigazione Desktop. **Storico Git** mostra grafo, commit e worktree; **Codice** apre schede di sola lettura da un singolo commit di `refs/heads/main`. Riutilizzare il percorso di ispezione Core → CLI locale → Electron main → preload → renderer. Nessuna modifica al daemon, al registro o ai checkout.

## Technical Context

- **Stack**: TypeScript strict, Node.js 26.13.0 nel Core, Electron e React nel Desktop; Git macOS dietro il runner confinato. Solo parser Lezer a bundle locale nel renderer, senza stili dinamici o estensioni di scrittura.
- **Storage**: Git locale e registro esistenti; contesto delle viste solo in memoria. Nessuna migrazione.
- **Testing**: Node test runner per contratti e integrazione con Git locale, Playwright per le viste.
- **Target**: macOS arm64 qualificato dal progetto; mantenere i limiti e il fail-closed dell'ispezione esistente.
- **Performance e scope**: primo gruppo di storico entro 3 s in almeno 9/10 delle prove SC-001; pagine limitate per storico e cartelle; blob fino a 1 MiB. Niente rete, operazioni Git in scrittura o modifica dei file.

## Constitution Check

| Principio | Prima della ricerca | Dopo il design |
| --- | --- | --- |
| I. Local-first | PASS: solo dati locali | PASS: ispezione senza rete, anche senza daemon quando il registro locale è leggibile |
| II. Core headless | PASS: Git nel Core | PASS: CLI locale tipizzata; renderer senza filesystem o shell |
| III. Provider agnostic | N/A: nessun provider | N/A: nessuna dipendenza da provider |
| IV. Git safety | PASS: niente mutazioni | PASS: identità repository verificata, operazioni ammesse esplicitamente, oggetti immutabili |
| V. Recovery | PASS: retry di sole letture | PASS: errore esplicito e risposte obsolete scartate; nessun effetto da riconciliare |
| VI. Approvazioni | N/A: nessuna mutazione | N/A: nessun gate esistente modificato |
| VII. Testabilità | PASS: fixture locali | PASS: contratti, integrazione Git e Desktop testano successo e guasti |
| VIII. Osservabilità | PASS: esiti espliciti | PASS: esiti correlati per richiesta/progetto, senza log di contenuti o dati Git grezzi |

## Project Structure

- **Core**: `src/core/inspect-main.ts`, `src/cli/`, `src/platform/macos/git/runner.ts`, nuovi reader `repository-history.ts` e `repository-code.ts` accanto a `repository-documents.ts`.
- **Desktop**: `apps/desktop/src/{main,preload,shared}/` per il bridge; `apps/desktop/src/renderer/` per le route e le nuove viste `RepositoryHistory.tsx` e `RepositoryCode.tsx`.
- **Test**: `tests/{contract,integration}/`, `apps/desktop/tests/{contract,e2e}/`.
- **Design**: [ricerca](./research.md), [modello dati](./data-model.md), [contratti](./contracts/repository-read.md), [quickstart](./quickstart.md).

**Structure Decision**: Prima condividere il trasporto e i controlli di identità; poi consegnare Storico Git (MVP), infine Codice. Le due viste non dipendono l'una dall'altra.

## Complexity Tracking

Nessuna deroga. Letture in pagine/chunk bounded anziché aumentare il limite dei frame del daemon. Nessuna replica dei dati Git e nessun servizio aggiuntivo.
