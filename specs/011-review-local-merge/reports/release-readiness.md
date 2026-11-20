# Readiness 011

**Readiness di rilascio BLOCKED.** T001–T036 completati sul ramo locale. Le tre storie sono implementate e verificate su fixture con CLI, Desktop, Git nativo e check 007 in loopback. [Validazione](validation.md) · [Qualifica](qualification.md)

| Principio | Verifica |
| --- | --- |
| I. Local-first | Schema cumulativo e lettura offline senza modifiche ai file dell'archivio. |
| II. Headless | CLI e conferme Desktop con lo stesso ledger. Ricevute consultabili tramite l'UUID originale. |
| III. Provider agnostic | Snapshot nel core, Git dietro porta OS e check 007 delegati. Reviewer assistito e qualifica del processo 009 reale ancora aperti. |
| IV. Git safety | Staging detached e guard posseduti da 006, CAS della ref esatta e sync con controllo di indice e file. Conflitti e file sopravvenuti conservati. |
| V. Recovery | Fasi durevoli, reflog attribuito e ripresa dopo CAS. Dieci retry, receipt atomica e query dopo reply loss. |
| VI. Approvals | Approvazione del candidate e grant d'integrazione distinti. Cleanup 006 richiede nuova approvazione e prova corrente. Il receipt indica che la futura pubblicazione richiede un grant dedicato. |
| VII. Testability | Suite mirate di unità, contratto, integrazione core e due E2E Electron. Review umana NOT_RUN. |
| VIII. Observability | Outbox con identificativi, diff privati a chunk, quota condivisa e operazione interrogabile. Saturazione outbox e recovery con riserva terminale provati localmente. |

Guard e staging restano registrati dopo l'integrazione. Il ramo target resta in checkout nel guard. L'anteprima 011 riguarda il workspace sorgente e delega la conferma a 006. La prenotazione Git segue il modello cooperativo descritto nel contratto. [Policy](../contracts/policy.md)

Restano aperti 001/T082 NOT_RUN, 001/T085 FAIL/OPEN, 002/T093 BLOCKED, 003/T054 REVIEW_PENDING, 004/T028 e T050 PROVIDER_UNSAFE, 005 G1 BLOCKED, 009 G1 NOT_RUN e il dispatch di produzione 010. [Readiness 010](../../010-session-scheduling/reports/release-readiness.md) · [Readiness 009](../../009-agent-execution/reports/release-readiness.md)
