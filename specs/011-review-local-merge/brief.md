# Brief — Review, Validation & Safe Local Merge

**Data**: 2026-11-19 · **Stato**: proposto, implementazione non avviata.

## Problema e risultato atteso

L’output dell’agente non dimostra che la feature soddisfi i criteri o possa essere integrata senza perdere lavoro.

## Ambito

Diff/commit, criteri, validazioni aggiornate, correzioni e approvazione integrazione; candidate immutabile e merge locale controllato; handoff cleanup006 e documentazione.

Nessun push, PR o deploy, force/reset/stash checkout utente o risoluzione conflitti automatica. Target in checkout esterno blocca il merge.

## Dipendenze e condizioni di ingresso

005 piano/criteri correnti,006 ownership e mutatore,007 job validazione,008 Reviewer,009 checkpoint e quiescenza.010 è baseline schema cumulativa; il caso singolo non richiede policy scheduling avanzate.

La progettazione non chiude i gate BLOCKED/NOT_RUN001–004 elencati nel [brief generale](../../docs/missing-features-brief.md). Gli upgrade richiedono l’ordine cumulativo della roadmap; le dipendenze funzionali sopra sono distinte.

## Percorso utente

1. Revisionare diff, criteri e controlli correnti: Vedere modifiche e verifiche relative all’esatto lavoro prima di decidere l’integrazione.
2. Approvare e integrare un candidate locale sicuro: Preparare il risultato del merge e approvarne l’integrazione sul target locale previsto.
3. Concludere review e aggiornare contesto e risorse: Mostrare integrazione, documentazione, freshness del progetto ed eventuale cleanup sicuro.

## Primo incremento e verifica

US1: Creare snapshot da run fixture quiescente, eseguire check locali, cambiare un file e verificare che le prove precedenti diventino stale.

[Specifica](spec.md), [piano](plan.md), [task](tasks.md) e [contratti trasversali](../../docs/missing-features-contracts.md) descrivono l’incremento. Le soglie sono obiettivi/cap da qualificare; nessun esito runtime è dedotto dal design.
