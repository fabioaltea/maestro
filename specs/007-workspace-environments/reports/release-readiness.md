# Readiness 007

Review T036 del 20 novembre 2026. Le tre storie sono verificate localmente con fixture su macOS arm64/APFS. La **readiness di rilascio resta BLOCKED** per i gate ereditati. [Validazione](validation.md) · [Qualifica](qualification.md)

| Principio | Evidenza locale |
| --- | --- |
| I · Local-first | Dati nel writer SQLite locale e consultazione offline immutabile. pnpm usa solo lo store Maestro e il registry loopback approvato. |
| II · Core headless | CLI ed Electron applicano lo stesso envelope e consultano l’UUID originale. Il daemon mantiene in carico il job dopo il ritorno del client. |
| III · Provider agnostic | Porte tipizzate per ispezione, esecuzione e lettura job. Tool pnpm e Node qualificati sul profilo macOS. |
| IV · Git safety | Le operazioni si legano al worktree verificato e alla lease. I file di input restano protetti dal profilo nativo e i controlli usano il worktree in sola lettura. |
| V · Recovery | Prova d’uscita legata a job, generazione e lease. Il successore conserva l’incertezza e legge la prova originale prima del rilascio. |
| VI · Approvazioni | Install, cancel, attestazione e validazione hanno intenti e grant distinti, revisioni e identità vincolate. |
| VII · Testabilità | Fixture locali, clock/porte iniettate, avvio reale confinato, casi pre/post effetto, retry e input cambiati. |
| VIII · Osservabilità | Eventi di soli metadati, esiti e output diagnostici bounded, indicazione di troncamento, artefatti con hash e recupero per UUID. |

| Gate | Stato |
| --- | --- |
| 007 G0 e US1–US3 | PASS nel profilo locale qualificato. Registry privati/autenticati e progetti reali fuori dalla qualifica. |
| 001/T082 | NOT_RUN. Runner reale secondo UID/macchina indisponibile. |
| 001/T085 | FAIL / OPEN. Qualifica IP-denied ancora aperta. |
| 002/T093 | BLOCKED dalle condizioni della campagna di accettazione reale. |
| 003/T054 | REVIEW_PENDING. Review umana e picker nativo NOT_RUN. |
| 004/T028 e T050 | BLOCKED dal precheck PROVIDER_UNSAFE prima dell’inferenza. |
| 005 G1 | BLOCKED da 004. Login e percorso assistito reali NOT_RUN. |
| 005 baseline ordinaria | Flake UPDATE replay 61 vs 60 ancora aperto. Il precedente isolamento era PASS. |
| 006 e 007 review umana | NOT_RUN. |

T001–T036 completati sul ramo locale di implementazione. [Readiness 006](../../006-git-workspaces/reports/release-readiness.md)
