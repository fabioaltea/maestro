# Verifica documentale — feature mancanti Maestro

**Data**: 2026-11-19 · **Esito**: PASS per struttura e coerenza della progettazione. Qualifica runtime e approvazione di prodotto non sono attestate da questo report.

## Risultato

Creati [brief generale](missing-features-brief.md), [contratti comuni](missing-features-contracts.md) e otto pacchetti005–012. Ogni pacchetto contiene brief, spec, plan, research, data-model, contracts/api, contracts/policy, quickstart, tasks e checklist dei requisiti:80documenti di feature.

| Feature | US | FR | SC | Task aperti | Checklist | Commit iniziale del pacchetto |
|---|---|---|---|---|---|---|
| [005-feature-planning](../specs/005-feature-planning/brief.md) | 3 | 12 | 4 | 36 (7 per US) | 16/16 | `a4aaa1a` |
| [006-git-workspaces](../specs/006-git-workspaces/brief.md) | 3 | 12 | 4 | 36 (7 per US) | 16/16 | `7fa58a2` |
| [007-workspace-environments](../specs/007-workspace-environments/brief.md) | 3 | 12 | 4 | 36 (7 per US) | 16/16 | `a9f8a1d` |
| [008-agent-profiles](../specs/008-agent-profiles/brief.md) | 3 | 12 | 4 | 36 (7 per US) | 16/16 | `c1abfd2` |
| [009-agent-execution](../specs/009-agent-execution/brief.md) | 3 | 12 | 4 | 36 (7 per US) | 16/16 | `cc0d3d6` |
| [010-session-scheduling](../specs/010-session-scheduling/brief.md) | 3 | 12 | 4 | 36 (7 per US) | 16/16 | `9c62bf3` |
| [011-review-local-merge](../specs/011-review-local-merge/brief.md) | 3 | 12 | 4 | 36 (7 per US) | 16/16 | `968d3ec` |
| [012-release-publishing](../specs/012-release-publishing/brief.md) | 3 | 12 | 4 | 36 (7 per US) | 16/16 | `7e67df7` |

Totale24storie,96requisiti,32criteri di successo,288task ancora aperti. Ogni pacchetto ha12opportunità [P] di scrittura test su file distinti, dopo i prerequisiti; le mutazioni dei file condivisi sono sequenziali. Complessità/rischi e criteri di completamento sono mappati per ID/range nei tasks.md. Nessuna durata di implementazione è promessa.

## Workflow eseguito

Per ogni feature, in ordine005→012:

1. Letti skill specify/plan/tasks, template, Constitution, hook e contesto001–004; generato il relativo brief.
2. Eseguito una sola volta l’hook obbligatorio `.specify/extensions/git/scripts/bash/create-new-feature.sh --json --short-name ...` e creati directory/spec/checklist; persistito il percorso in `.specify/feature.json`.
3. Eseguito `.specify/scripts/bash/setup-plan.sh --json`, riempito il piano e prodotti ricerca, modello, due contratti e quickstart. Gate costituzionali verificati prima/dopo design.
4. Eseguito `.specify/scripts/bash/update-agent-context.sh codex`; corretto il contesto generato affinché i piani siano dichiarati PROPOSTI e non tecnologie implementate, preservando integralmente baseline/report/manual additions di AGENTS.md.
5. Eseguito `.specify/scripts/bash/check-prerequisites.sh --json`, generati task per storia e ripetuto il check con `--require-tasks --include-tasks`.
6. Salvato un commit locale del pacchetto con staging limitato ai documenti richiesti. Hook opzionali speckit.git.commit controllati: disabilitati in git-config, nessun auto-stage globale.

I branch sono una catena documentale dalla baseline004 `d798a94`: l’ultimo `012-release-publishing` contiene tutti i pacchetti. Le correzioni e il report di review trasversale sono salvati nel commit conclusivo. I branch precedenti identificano il checkpoint iniziale del relativo pacchetto; usare l’ultimo branch per la versione consolidata di tutti i documenti. Non sono branch di implementazioni concluse.

Feature attiva finale: `specs/012-release-publishing`. Per operare sulla005 con i comandi successivi usare esplicitamente `SPECIFY_FEATURE_DIRECTORY=/Users/fabioaltea/Repository/maestro/specs/005-feature-planning`; la feature directory è indipendente dal nome branch. Non avviare implementazione012 saltando i prerequisiti.

## Controlli e prove

- PASS:80artefatti richiesti presenti; nessun link Markdown locale mancante all’interno dei pacchetti.
- PASS: template compilati, nessun segnaposto di chiarimento o task d’esempio rimasto.
- PASS: task T001–T036 sequenziali per pacchetto, tutti unchecked e con percorsi;7task per US, etichette [USn] solo nelle fasi di storia, [P] solo su test indipendenti.
- PASS:12FR/4SC/3US per spec, priorità ordinate; ogni gruppo FR è mappato alla storia e ai task, requisiti trasversali e principi ai test pertinenti.
- PASS: otto principi nella Constitution Check di ogni piano; inclusi casi negativi, crash/retry/concorrenza, autorizzazioni e output bounded.
- PASS: checklist16/16 per pacchetto come qualità dei requisiti, non esiti della futura implementazione.
- PASS: check-prerequisites finale per tutte le otto cartelle con percorso assoluto esplicito; disponibili research, data-model, contracts, quickstart e tasks.
- PASS: `git diff d798a94 --check` dopo rimozione degli spazi finali; nessuna modifica a sorgenti, test, package/lockfile o specifiche/report001–004.
- PASS: AGENTS.md conserva il testo della baseline e le aggiunte manuali; le sole nuove righe descrivono piani non implementati. `apps/desktop/package-lock.json` preesistente resta non tracciato ed escluso dai commit.

Controllo di coerenza finale: specificato upload bounded comune; distinti gate manuale/assistito005; cleanup006 ammette prova ancestry corrente senza dipendenza circolare da011; ambiente manuale007 distinto da qualifica automatica; ownership/ambiente del candidate011 esplicitamente predisposti e verificati. Policy provider/credenziali, merge target riservato e autorizzazioni release sono dettagliate nei contratti per feature.

Non eseguiti build/test runtime, installazioni, provider/login reali, operazioni Git sui progetti, merge, push o deployment: la modifica è esclusivamente documentale. I comandi dei quickstart e tutti i task sono futuri. Gli script Spec Kit e i controlli strutturali sopra sono stati realmente eseguiti; non sono test delle nuove capability.

## Readiness e primo incremento

Progettazione pronta per review di prodotto e futura implementazione incrementale, con tutti i task aperti. Primo incremento consigliato005/US1, poi005/US2 per approval/handoff. La generazione assistita005/US3 e l’esecuzione009 richiedono le proprie qualifiche. Un archivio reale senza Discovery corrente resta inidoneo alla creazione feature anche usando authoring manuale.

Gate esistenti invariati:001/T082/T085,002/T093,003/T054 e004/T028/T050; provider reale004 PROVIDER_UNSAFE prima dell’inferenza, SC-001 non dimostrato e failure dell’ultimo run core non risolta. Nessun PASS documentale supera questi blocchi. Campagne volume/durata rinviate non sono ricreate. La roadmap distingue lo schema cumulativo5→12 dalle dipendenze funzionali e non introduce una seconda riscrittura della base implementata.
