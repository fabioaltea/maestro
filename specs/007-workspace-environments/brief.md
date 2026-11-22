# Brief — Workspace Environments & Dependencies

**Data**: 2026-11-19 · **Stato**: proposto, implementazione non avviata.

## Problema e risultato atteso

Un worktree necessita di dipendenze e comandi preparati in modo ripetibile senza condividere directory mutabili o cambiare package manager del progetto.

## Ambito

Rilevamento statico, piano d’ambiente, preparazione pnpm autorizzata, stato e job di validazione controllati; percorso manuale esplicito per altri ecosistemi.

Nessuna conversione automatica npm/yarn→pnpm, installazione globale/auto-update, terminale libero, pruning store globale o sofisticata build cache.

## Dipendenze e condizioni di ingresso

006 per workspace/ownership/lease.007 non dipende009: host job ambiente e provider runtime sono porte distinte;008 usa la capability EnvironmentJob successivamente.

La progettazione non chiude i gate BLOCKED/NOT_RUN001–004 elencati nel [brief generale](../../docs/missing-features-brief.md). Gli upgrade richiedono l’ordine cumulativo della roadmap; le dipendenze funzionali sopra sono distinte.

## Percorso utente

1. Rilevare e approvare il piano d’ambiente: Vedere manager, input, script/config rischiosi, rete e costi locali prima dell’installazione.
2. Preparare dipendenze isolate: Avviare installazione qualificata e verificare che il workspace diventi pronto solo per gli input esatti.
3. Eseguire controlli e recuperare i job: Lanciare comandi di validazione approvati, leggere risultati ed esplicitare recovery/manualità.

## Primo incremento e verifica

US1: Su repository pnpm/npm/ambiguo leggere manifest e produrre PLANNED o MANUAL_REQUIRED senza spawn né modifica.

[Specifica](spec.md), [piano](plan.md), [task](tasks.md) e [contratti trasversali](../../docs/missing-features-contracts.md) descrivono l’incremento. Le soglie sono obiettivi/cap da qualificare; nessun esito runtime è dedotto dal design.
