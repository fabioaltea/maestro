# Brief — Release Publishing, Pull Requests & Deployment Gates

**Data**: 2026-11-19 · **Stato**: proposto, implementazione non avviata.

## Problema e risultato atteso

Il merge locale deve poter essere pubblicato e seguito fino a CI e deployment senza confondere azioni e autorizzazioni o ripetere effetti remoti incerti.

## Ambito

Piano release versionato, push ordinario su origin, tag opzionali approvati, PR e osservazione CI con adapter esplicito, deployment solo per adapter configurato e grant dedicato; CLI e desktop.

Nessun force push, delete remoto, bypass branch protection, credenziali Maestro copiate, provider CI/CD presunto o deploy automatico non autorizzato.

## Dipendenze e condizioni di ingresso

011 IntegrationReceipt corrente e008 Release Manager.010 policy/scheduler per job; senza adapter PR/CI/DEPLOY la capability resta UNSUPPORTED e il push/manual handoff è completo come MVP.

La progettazione non chiude i gate BLOCKED/NOT_RUN001–004 elencati nel [brief generale](../../docs/missing-features-brief.md). Gli upgrade richiedono l’ordine cumulativo della roadmap; le dipendenze funzionali sopra sono distinte.

## Percorso utente

1. Approvare e pubblicare un commit integrato: Preparare un piano e fare push esplicito su origin preservando le protezioni remote.
2. Aprire una PR e seguire la CI del commit corretto: Usare workflow protetti e vedere prove CI riferite al commit pubblicato, senza presumere che una PR integri o distribuisca.
3. Autorizzare deployment e automazioni limitate: Decidere separatamente l’ambiente da distribuire e le eventuali policy automatiche.

## Primo incremento e verifica

US1: Remote bare temporaneo, receipt011 fixture e grant PUSH: pubblicare esatto OID, simulare auth/failure/response loss e rifiutare remote mutato.

[Specifica](spec.md), [piano](plan.md), [task](tasks.md) e [contratti trasversali](../../docs/missing-features-contracts.md) descrivono l’incremento. Le soglie sono obiettivi/cap da qualificare; nessun esito runtime è dedotto dal design.
