# Readiness 010

**BLOCKED**. Schema 10, coda, grant, reservation, consultazione CLI/Desktop e recupero conservativo sono verificati localmente. Il percorso di fixture usa un executor iniettabile. La composizione standard mostra dispatch indisponibile. [Validazione](validation.md) · [Qualifica](qualification.md)

| Principio | Riscontro |
| --- | --- |
| I. Local-first | Writer SQLite condiviso, upgrade esplicito e consultazione offline immutabile. |
| II. Headless | Prepare/confirm e coda in CLI, Desktop con bridge di consultazione. Conferme Desktop e relativi E2E aperti. |
| III. Provider agnostic | Fallback e costo verificati come decisioni pure con capability e consenso. Adapter produttivi e quote reali aperti. |
| IV. Git safety | Coda senza mutazioni Git e debit per workspace. Adattamento completo ai lease dei consumer aperto. |
| V. Recovery | Il successore conserva il debit privo di prova. Il risultato originale è interrogabile. |
| VI. Approvals | Grant con revisioni e originale delegato ancora valido. Automazione sticky e rinnovo schedulato aperti. |
| VII. Testability | Fixture indipendenti da credenziali reali, test pre/post migrazione e processi locali brevi. Matrice completa delle tre storie ancora aperta. |
| VIII. Observability | Outbox redatta, quote condivise e stato offline. Campionamento CPU/RAM e wake da eventi provider aperti. |

Restano i gate 001/T082 NOT_RUN, 001/T085 FAIL/OPEN, 002/T093 BLOCKED, 003/T054 REVIEW_PENDING, 004/T028 e T050 PROVIDER_UNSAFE, 005 G1 BLOCKED e 009 G1 NOT_RUN. Le review umane restano aperte.
