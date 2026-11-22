# Brief — Owned Git Workspaces

**Data**: 2026-11-19 · **Stato**: proposto, implementazione non avviata.

## Problema e risultato atteso

L’implementazione concorrente deve partire da branch e worktree dedicati con proprietà dimostrabile, preservando checkout e lavoro dell’utente.

## Ambito

Provisioning da feature approvata; osservazione/lease; riconciliazione e cleanup esplicito senza perdita. CLI e desktop.

Nessuna installazione, avvio agente, merge o push. Il cleanup di lavoro non integrato resta bloccato; scarto distruttivo è escluso dalla prima versione.

## Dipendenze e condizioni di ingresso

005 per handoff corrente;002 per repository identity, baseBranch configurato e ispezione. Schema6 segue5.

La progettazione non chiude i gate BLOCKED/NOT_RUN001–004 elencati nel [brief generale](../../docs/missing-features-brief.md). Gli upgrade richiedono l’ordine cumulativo della roadmap; le dipendenze funzionali sopra sono distinte.

## Percorso utente

1. Preparare un workspace da un piano approvato: Creare un branch dedicato da base locale configurata e un worktree posseduto.
2. Osservare, riservare e recuperare workspace: Mostrare stato corrente e impedire due writer concorrenti; riconciliare dopo restart senza adottare risorse estranee.
3. Rimuovere soltanto un workspace sicuro: Liberare lo spazio dopo integrazione dimostrata, conservando il lavoro quando la prova manca.

## Primo incremento e verifica

US1: In repository temporaneo creare due workspace per due feature, verificare OID di partenza e snapshot del checkout originale invariato.

[Specifica](spec.md), [piano](plan.md), [task](tasks.md) e [contratti trasversali](../../docs/missing-features-contracts.md) descrivono l’incremento. Le soglie sono obiettivi/cap da qualificare; nessun esito runtime è dedotto dal design.
