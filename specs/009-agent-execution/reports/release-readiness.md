# Readiness 009

**BLOCKED** al 20 novembre 2026. La base locale include schema 9, ledger sessioni e run, quote, CLI, vista Sessioni e ripresa esplicita verificata su fixture. G0 Codex app-server in loopback sintetico PASS, G1 ufficiale NOT_RUN. Claude resta BLOCKED con `PROVIDER_UNSAFE` durante il precheck. [Qualifica](qualification.md) · [Validazione](validation.md)

| Principio | Verifica |
| --- | --- |
| I. Local-first | Writer SQLite condiviso e upgrade su start esplicito. Lettura offline immutabile, cronologia con freshness. |
| II. Headless core | RPC/pagine e grant di core, CLI e ricevute Electron con UUID originale. End-to-end interattivo nativo ancora aperto. |
| III. Provider agnostic | Porte separate da Discovery, split fra prove G0 e G1. Avvio reale disabilitato e nessuna capability nativeResume esposta. |
| IV. Git safety | Scrittura confinata dimostrata per il file di fixture. Patch Git bounded e indice verificato. Commit sotto grant dedicato da qualificare. |
| V. Recovery | Unknown visibile, lease conservato e nessun replay del run. Crash pre/post migrazione e successore senza exit proof verificati. Host per-run indipendente e fault matrix completa aperti. |
| VI. Approvals | Grant monouso con versioni e digest, controllo permessi `WORKSPACE_WRITE` e confronto atomico prima di GO. |
| VII. Testability | Test deterministici di writer/contract e prova sintetica Mac con i pin. Gate reali e review umana pendenti. |
| VIII. Observability | Outbox atomica con metadata, output privato paginato e riserva per azioni terminali. Ricevute persistite prima dell’invio. |

## Task aperti

- T017, T020, T024 e T031. Restano il collegamento di produzione dell’host indipendente, mediazione completa degli stream, attesa senza processo e commit Git su manifest autorizzato. Il checkpoint portabile esplicito è disponibile nella composizione di fixture.
- T019, T022, T026 e T033. Il bridge Desktop, le ricevute, l’offline e la conferma di riconciliazione sono verificati. Restano gli scenari completi di avvio, risposta da CLI e ripresa con run attivo.
- T027 e T029. Resume stale, limiti del checkpoint e recupero conservativo sono verificati. Restano i fault di pubblicazione e l’intera matrice fra GO, uscita e creazione checkpoint.

## Gate ereditati

001/T082 NOT_RUN, 001/T085 FAIL/OPEN, 002/T093 BLOCKED, 003/T054 REVIEW_PENDING, 004/T028/T050 PROVIDER_UNSAFE prima dell’inferenza e 005 G1 BLOCKED. Le review umane precedenti restano pendenti. I risultati locali di 008 e 009 conservano questi stati. [Readiness 008](../../008-agent-profiles/reports/release-readiness.md)

L’incremento è su branch locale con un commit per task. Integrazione e pubblicazione sono fuori da questa review.
