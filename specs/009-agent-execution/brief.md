# Brief — Agent Sessions, Runs & Portable Checkpoints

**Data**: 2026-11-19 · **Stato**: proposto, implementazione non avviata.

## Problema e risultato atteso

Manca l’implementazione di una feature in un workspace con run supervisionati e stato recuperabile indipendente dalla UI.

## Ambito

Sessioni e run provider-neutral; primo Codex write/exec qualificato; adapter Claude con gate indipendente; output/interazione, checkpoint e ripresa esplicita, CLI e desktop.

Nessun failover automatico o scheduling avanzato (010), merge/pubblicazione (011/012), terminale PTY libero o promessa di trasferimento memoria conversazionale.

## Dipendenze e condizioni di ingresso

005 handoff approvato,006 workspace lease,007 ambiente/piano comandi,008 snapshot profilo;004 gate reali restano aperti e non certificano write execution.

La progettazione non chiude i gate BLOCKED/NOT_RUN001–004 elencati nel [brief generale](../../docs/missing-features-brief.md). Gli upgrade richiedono l’ordine cumulativo della roadmap; le dipendenze funzionali sopra sono distinte.

## Percorso utente

1. Avviare una sessione di implementazione autorizzata: Scegliere un profilo e provider qualificato e lavorare nel workspace previsto.
2. Monitorare e interagire senza dipendere dalla UI: Leggere avanzamento, domande e tool request; interrompere o mettere in pausa senza perdere il lavoro.
3. Recuperare e riprendere da checkpoint: Riconoscere run interrotti e continuare con un nuovo run senza ripetere effetti incerti.

## Primo incremento e verifica

US1: Con provider locale simulato avviare un run che modifica un file autorizzato; grant stale o tentativi fuori workspace non producono effetti.

[Specifica](spec.md), [piano](plan.md), [task](tasks.md) e [contratti trasversali](../../docs/missing-features-contracts.md) descrivono l’incremento. Le soglie sono obiettivi/cap da qualificare; nessun esito runtime è dedotto dal design.
