# Brief — Agent Profiles, Skills & Tools

**Data**: 2026-11-19 · **Stato**: proposto, implementazione non avviata.

## Problema e risultato atteso

I ruoli e le istruzioni oggi specifici della Discovery non consentono profili riusabili con skill, tool, provenienza e permessi riproducibili.

## Ambito

Registry locale versionato globale/progetto/profilo; sei ruoli iniziali; import skill SKILL.md e tool manifest; risoluzione e consenso su install/config locale.

Nessun marketplace pubblico, download automatico, esecuzione skill/tool durante import, credenziali nel registry o ampliamento permessi tramite testo.

## Dipendenze e condizioni di ingresso

004 per Project Architect esistente e progetti;007 come baseline schema cumulativa.009 consumer futuro del profilo risolto, non prerequisito.

La progettazione non chiude i gate BLOCKED/NOT_RUN001–004 elencati nel [brief generale](../../docs/missing-features-brief.md). Gli upgrade richiedono l’ordine cumulativo della roadmap; le dipendenze funzionali sopra sono distinte.

## Percorso utente

1. Definire e scegliere profili versionati: Creare ruoli riusabili e vedere cosa riceverà l’agente prima di avviarlo.
2. Importare e associare skill con provenienza: Usare skill locali globali, di progetto e di profilo distinguendo obbligatorie e consigliate.
3. Configurare tool e permessi senza escalation: Abilitare tool dichiarati e vedere suggerimenti compatibili senza avviarli o concedere più diritti.

## Primo incremento e verifica

US1: Creare seed Project Architect/Frontend/Backend/QA/Reviewer/Release Manager come dati, risolvere uno e modificare il profilo verificando lo snapshot storico.

[Specifica](spec.md), [piano](plan.md), [task](tasks.md) e [contratti trasversali](../../docs/missing-features-contracts.md) descrivono l’incremento. Le soglie sono obiettivi/cap da qualificare; nessun esito runtime è dedotto dal design.
