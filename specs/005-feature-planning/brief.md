# Brief — Feature Planning & Versioned Approval

**Data**: 2026-11-19 · **Stato**: proposto, implementazione non avviata.

## Problema e risultato atteso

Dopo Discovery manca un oggetto feature con richiesta, specifica, piano, criteri e approvazione corrente. L’utente deve poter preparare lavoro verificabile senza avviare un agente di implementazione.

## Ambito

Authoring manuale completo; generazione assistita readonly opzionale con intervista; revisioni append-only, approvazione e handoff. CLI e desktop.

Nessun branch/worktree, installazione, implementazione, merge o pubblicazione. Non riutilizzare ArchitectResult come se fosse una specifica feature.

## Dipendenze e condizioni di ingresso

004 per projectId, documento approvato ed eligibility attuale. Il percorso reale dipende dalla chiusura del blocco provider004; fixture approvate servono solo nei test. Non dipende009.

La progettazione non chiude i gate BLOCKED/NOT_RUN001–004 elencati nel [brief generale](../../docs/missing-features-brief.md). Gli upgrade richiedono l’ordine cumulativo della roadmap; le dipendenze funzionali sopra sono distinte.

## Percorso utente

1. Creare e correggere una feature: Descrivere una richiesta, compilare specifica e piano e conservare revisioni senza eseguire codice.
2. Approvare un piano e preparare l’implementazione: Approvare una precisa revisione e produrre un handoff che i moduli successivi possano rivalidare.
3. Ottenere una bozza assistita e rispondere alle domande: Richiedere analisi readonly e rispondere a domande mantenendo le assunzioni visibili.

## Primo incremento e verifica

US1: Con progetto fixture approvato creare una feature manuale, revisionarla e rileggerla dopo restart; senza approvazione valida non compare alcuna nuova feature.

[Specifica](spec.md), [piano](plan.md), [task](tasks.md) e [contratti trasversali](../../docs/missing-features-contracts.md) descrivono l’incremento. Le soglie sono obiettivi/cap da qualificare; nessun esito runtime è dedotto dal design.
