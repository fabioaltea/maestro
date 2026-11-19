# Readiness 006

Review T036 del 19 novembre 2026. Le tre storie sono qualificate localmente con fixture. **Readiness globale BLOCKED** per i gate precedenti. [Validazione](validation.md) · [Qualifica](qualification.md)

| Principio | Verifica locale |
| --- | --- |
| I · Local-first | Stesso archivio SQLite, writer WAL/FULL e reader storico confinato. |
| II · Core headless | Decisioni nel daemon, CLI e desktop con UUID e receipt originali. |
| III · Provider agnostic | Handoff neutro per il core, nessun processo provider dentro Workspace. |
| IV · Git safety | Pin Xcode, branch e path derivati, anchor, claim per repository, integrazione e CAS. |
| V · Recovery | Effetti prima/dopo, owner e revisioni persistenti. Incertezza interrogabile e nessun replay cieco. |
| VI · Approvals | Grant monouso per scope, revisione e OID correnti con conferma distinta per rimozione. |
| VII · Testability | Suite locali mirate con Git reale in repository temporanei, fixture e fault isolati. |
| VIII · Observability | Eventi metadata atomici, limiti e redazione, pagine storiche e recupero per UUID. |

| Gate esterno | Stato |
| --- | --- |
| 001/T082 | NOT_RUN. Runner secondo UID/macchina indisponibile. |
| 001/T085 | FAIL / OPEN. Accettazione con IP negato aperta. |
| 002/T093 | BLOCKED. Qualifica ambientale di accettazione aperta. |
| 003/T054 | REVIEW_PENDING. Review umana e picker reale NOT_RUN. |
| 004/T028 e T050 | BLOCKED dal precheck PROVIDER_UNSAFE prima dell’inferenza. |
| 005 G1 | BLOCKED da 004. Login e percorso assistito reali NOT_RUN. |
| Baseline ordinaria 005 | Flake UPDATE replay 61 vs 60 aperto, isolato precedente PASS. |

T001–T036 chiusi localmente. Le prove citate non vanno estese a checkout utente o a provider reali. La review umana 006 resta NOT_RUN. [Readiness 005 e riferimenti ai gate precedenti](../../005-feature-planning/reports/release-readiness.md)
