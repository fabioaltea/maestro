# Readiness 008

Review del 20 novembre 2026. T001–T036 verificati localmente con fixture. Readiness di rilascio **BLOCKED** per i gate ereditati. [Validazione](validation.md) · [Qualifica](qualification.md)

| Principio | Esito locale |
| --- | --- |
| I · Local-first | Catalogo nello stesso archivio SQLite e letture storiche immutabili. |
| II · Headless | Policy nel daemon. CLI ed Electron usano grant, ricevute e UUID originali. |
| III · Provider agnostic | Snapshot neutri con capability esplicita. Registrare un tool conserva solo la definizione. |
| IV · Git safety | Reader confinato in sola lettura e riferimenti a scope/versione del progetto. |
| V · Recovery | Upgrade esclusivo, CAS, transazioni atomiche e replay controllato. |
| VI · Approvals | Conferme distinte per import, associazione e abilitazione. Lattice conserva i deny. |
| VII · Testability | Fixture macOS e Git temporanee, test schema, contratti e flussi Electron. |
| VIII · Observability | Eventi di metadati, chunk bounded, identificativi correlati e quote condivise. |

001/T082 NOT_RUN; 001/T085 FAIL/OPEN; 002/T093 BLOCKED; 003/T054 REVIEW_PENDING; 004/T028 e T050 PROVIDER_UNSAFE; 005 G1 BLOCKED e flake baseline ancora aperta. Review umana 006–008 NOT_RUN. La qualifica di esecuzione tool appartiene alla 009. [Gate precedenti](../../007-workspace-environments/reports/release-readiness.md)
