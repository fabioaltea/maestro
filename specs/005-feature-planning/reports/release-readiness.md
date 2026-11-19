# Readiness di rilascio 005

Review T036 del 19 novembre 2026 sul branch `005-feature-planning-implementation`. **Readiness globale BLOCKED**. Implementazione locale, suite mirate e quickstart con fixture completati per le tre storie. Il percorso assistito nel daemon di produzione resta indisponibile fino alla qualifica ufficiale. [Validazione](validation.md) · [Qualifica](qualification.md)

## Review costituzionale

| Principio | Evidenza e limiti |
|---|---|
| I. Local-first | Stato, artefatti e decisioni rimangono nell’archivio locale. La consultazione confinata offline è stata verificata senza avvio del servizio o aggiornamento dello schema. |
| II. Core headless | CLI ed Electron usano il contratto del daemon. Writer, CAS, policy e recupero sono nel core. Il client desktop conserva la ricevuta prima dell’invio e interroga l’UUID originale. |
| III. Provider agnostic | La porta assistita usa tipi neutri e prove di uscita. Il decoder Codex è isolato. Il daemon ordinario dichiara `qualified: false`. L’esecuzione assistita è verificata con fixture e il binario fissato è qualificato su backend sintetico per G0. |
| IV. Git safety | Le prove locali ricontrollano contesto, revisione e approvazione Discovery. Gli snapshot delle repository fixture coincidono dopo authoring, approvazione, handoff e generazione assistita. |
| V. Recovery | Ledger a UUID, replay e CAS su versione/generazione. Un esito incerto resta interrogabile e mantiene il debit. Exit proof errata e arresto bloccato sono verificati con fixture. |
| VI. Approvazioni | Grant monouso per azione, store, contesto e revisione. Il consenso assistito include modello e qualifica. L’handoff è un riferimento immutabile. I permessi per implementazione, integrazione e pubblicazione appartengono ai rispettivi flussi. |
| VII. Testabilità | Porte e clock sostituibili, scenari locali sulle tre storie, prove IPC/API/CLI e desktop su archivi temporanei. Review umana e prove ufficiali restano aperte. |
| VIII. Osservabilità | Eventi metadata correlati, errori pubblici bounded, output in artefatti sigillati, pagine e recupero dopo risposta persa. La saturazione della quota è coperta da fixture mirate. |

## Gate esterni

| Dipendenza | Stato |
|---|---|
| Foundation 001/T082 | NOT_RUN. Runner reale con secondo UID/macchina indisponibile. |
| Foundation 001/T085 | FAIL / OPEN. Accettazione completa con IP negato ancora aperta. |
| Project Registry 002/T093 | BLOCKED. Qualifica ambientale di accettazione aperta. |
| Desktop 003/T054 | REVIEW_PENDING. Review umana e picker nativo reale NOT_RUN. |
| Discovery 004/T028 e T050 | BLOCKED. Precheck ufficiale `PROVIDER_UNSAFE` prima dell’inferenza. La prova end-to-end reale resta NOT_RUN. |
| Feature Planning 005 G1 | BLOCKED da Discovery 004. Login e inferenza ufficiali 005 NOT_RUN. |
| Baseline ordinaria 005 | Il fallimento intermittente UPDATE replay revision 61 vs 60 resta aperto. L’isolato precedente passava. T034 ha eseguito le suite mirate. |

Fonti dei gate. [Foundation 001](../../001-core-background-daemon/reports/release-readiness.md) · [Project Registry 002](../../002-project-registry/reports/release-readiness.md) · [Desktop 003](../../003-desktop-core-ui/reports/release-readiness.md) · [Discovery 004](../../004-project-discovery/reports/release-readiness.md)

T036 conclude la review documentale con decisione BLOCKED. Lo stato dei task locali è registrato nel piano di lavoro. [Task 005](../tasks.md)
