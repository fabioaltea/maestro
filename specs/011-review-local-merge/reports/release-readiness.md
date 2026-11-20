# Readiness 011

**BLOCKED**. Schema 11, snapshot e diff di review sono disponibili tramite CLI. Desktop legge cronologia e diff. Il port Git ha superato G0 per il fast-forward sulla fixture. La build standard non offre integrazione locale. [Validazione](validation.md) · [Qualifica](qualification.md)

| Principio | Verifica |
| --- | --- |
| I. Local-first | Schema cumulativo e lettura offline senza modifiche ai file dell'archivio. |
| II. Headless | CLI con grant su snapshot e feedback. Desktop con letture scoped, conferma UI ancora aperta. |
| III. Provider agnostic | Snapshot dal core e confini Git nativi. Reviewer assistito non qualificato. |
| IV. Git safety | Guard senza force, CAS della ref richiesta e sync dopo controllo di indice/file. Verifiche native su fixture. Candidate divergente e registrazione staging ancora aperti. |
| V. Recovery | Replay dello snapshot con UUID originale. Fault pre/post CAS e rifiuto di sync su worktree discordante osservati. Recovery durevole dell'integrazione ancora aperto. |
| VI. Approvals | Snapshot lega checkpoint, worktree, feature, source/target e hash delle parti. Receipt e cleanup distinti a livello di dominio. Workflow completo d'integrazione e pubblicazione mantiene gate separati. |
| VII. Testability | Test unitari, contratti, Git nativo locale e due E2E mirati. Review umana e flusso intero aperti. |
| VIII. Observability | Outbox con identificativi, diff privati a chunk, quota condivisa e operazione interrogabile. Fault matrix e backpressure dell'integrazione ancora aperti. |

Restano aperti i controlli 007 sul tree del candidate, i workspace guard/staging registrati e la conferma e riconciliazione dell'integrazione. Per la chiusura rimangono il receipt autorevole, freshness Discovery, cleanup 006 e i relativi flussi Desktop. I task preparatori con prova locale sono marcati in `tasks.md`.

Gate ereditati da 001–009 e 010 conservati. La 010 ha fornito la base schema 10. G1 009 resta NOT_RUN. [Readiness 010](../../010-session-scheduling/reports/release-readiness.md) · [Readiness 009](../../009-agent-execution/reports/release-readiness.md)
