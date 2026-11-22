# Brief — Session Scheduling, Quotas & Provider Policies

**Data**: 2026-11-19 · **Stato**: proposto, implementazione non avviata.

## Problema e risultato atteso

Il runtime singolo deve governare più progetti con limiti, code e attese esplicite; un provider indisponibile non può causare retry duplicati o cambi non autorizzati.

## Ambito

Coda persistente, concorrenza e risorse, pause/resume programmato, sticky/fallback/cost-aware con checkpoint e policy esplicite; CLI e desktop.

Nessun provider extra non qualificato, previsione inventata di quote/prezzi/reset, cron distribuito, autoscaling cloud o benchmark di lunga durata.

## Dipendenze e condizioni di ingresso

009 runtime/checkpoint e capability;007 install/validation jobs. Discovery004 integrata solo come consumer del budget, con limite1 e policy readonly invariati.

La progettazione non chiude i gate BLOCKED/NOT_RUN001–004 elencati nel [brief generale](../../docs/missing-features-brief.md). Gli upgrade richiedono l’ordine cumulativo della roadmap; le dipendenze funzionali sopra sono distinte.

## Percorso utente

1. Accodare e limitare il lavoro tra progetti: Eseguire più sessioni senza saturare risorse o far scrivere due agenti nello stesso workspace.
2. Attendere quote e riprendere con policy sticky: Vedere perché una sessione attende e decidere quando tentare di nuovo senza polling o retry ciechi.
3. Applicare fallback e scelta per costo con checkpoint: Scegliere alternative compatibili e autorizzate preservando lavoro e privacy.

## Primo incremento e verifica

US1: Con clock controllato e tre progetti accodare12job; osservare round-robin e cap4/2/2 più lease, poi simulare restart a reservation.

[Specifica](spec.md), [piano](plan.md), [task](tasks.md) e [contratti trasversali](../../docs/missing-features-contracts.md) descrivono l’incremento. Le soglie sono obiettivi/cap da qualificare; nessun esito runtime è dedotto dal design.
