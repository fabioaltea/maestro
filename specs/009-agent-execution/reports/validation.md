# Validazione 009

## T001 — baseline

20 novembre 2026. Base `f5710d2` di 008. Schema 8, writer SQLite unico, snapshot dei profili verificabili per digest e revisione. Checklist requisiti 16/16. Baseline 008 con 33 test core, 54 desktop unit/contract e 3 E2E PASS. [Validazione 008](../../008-agent-profiles/reports/validation.md)

001/T082 NOT_RUN e T085 FAIL/OPEN, 002/T093 BLOCKED, 003/T054 REVIEW_PENDING, 004/T028 e T050 PROVIDER_UNSAFE, 005 G1 BLOCKED. Le prove 009 usano binari locali, profili e fixture sintetiche. Login ufficiale e prova su account rimangono gate distinti. [Readiness 008](../../008-agent-profiles/reports/release-readiness.md)

## T002–T003 — precheck e comparti

Tre RED iniziali. Il probe nativo separa il processo provider dal comando di fixture, con rete solo sul loopback sintetico e scrittura limitata a un file regolare con link count 1. Pin del binario verificato prima dei probe. Il launcher raccoglie esiti bounded e osserva la chiusura del suo handle.

## T034 — verifica locale del 20 novembre 2026

macOS 26.3.1 (a), arm64/APFS, Node 26.13.0. Gli effetti sono stati eseguiti su checkout e archivi di fixture posseduti dalla suite.

| Comando o selezione | Esito |
| --- | --- |
| `npm run build`, `npm run build:test`, `npm run typecheck`, `npm run lint` | PASS |
| `npm run build:desktop`, `npm run typecheck:desktop` | PASS |
| `MAESTRO_EXECUTION_G0=1 node --test dist-tests/tests/{unit/execution-*,contract/execution-*,integration/execution-*,integration/profile-schema}.test.js` | 37 PASS, 0 FAIL, 0 SKIP. Comprende 5 prove G0 e 4 regressioni schema 7→8. |
| Regressioni Core su profili, ambiente US1 e lease workspace | 26 PASS, 0 FAIL, 0 SKIP. Include i 4 casi schema 7→8 della selezione precedente. |
| `npm run test:desktop:unit` | 57 PASS, 0 FAIL, 0 SKIP. |
| Integrazioni Desktop `action-dispatch`, `operation-recovery`, `receipts`, `feature-receipts` | 10 PASS, 0 FAIL, 0 SKIP. |
| `npm run test:desktop:e2e -- execution-flow.spec.ts` | 2 PASS, 0 FAIL, 0 SKIP. Archivio live/offline, cambio archivio, conferma e focus, ricevuta di riconciliazione su stato sintetico. |

| Requisiti | Evidenza locale | Verifica rimanente |
| --- | --- | --- |
| FR-001–003 / US1 | Grant su feature, ambiente, profilo, provider e digest del worktree, lease esclusivo, GO condizionato a scritture durevoli. La fixture nativa modifica il solo file autorizzato, l’intento superato si ferma prima di aprire il processo, il replay recupera il run originale. | Host indipendente e broker di produzione con login ufficiale. |
| FR-004–006 / US2 | Output su artefatti sigillati, domanda/risposta con revisione, risposta tardiva respinta, cancel con prova di close, test nativo di deadline e cap del parser. | Collegamento completo degli stream provider, attesa e prosecuzione oltre l’uscita del processo, prova unica CLI→Desktop su interazione attiva. |
| FR-007–009 / US3 | Patch Git bounded con indice invariato, checkpoint esplicito dopo uscita, ripresa con nuova generazione e verifica del tree, lease trattenuto dal successore con prova assente. | Matrice completa di fault, commit da manifest approvato e ripresa su provider diverso. La pausa lascia disponibile il checkpoint esplicito. |
| FR-010–012 | Protocollo chiuso, chunk raw fino a 8 KiB e pagine fino a 20, inspection offline immutabile, migrazione 8→9 pre/post commit, UUID cross-ledger, quote e riserva terminale, eventi senza testo/challenge/PID, ricevute scoped. | Verifica integrata con listener e provider reali. |

I criteri di successo per l’uso reale e i target di ammissione in 2 s e durata massima su host end-to-end restano senza misura di qualifica. Il test di deadline usa 500 ms su un processo sintetico e quello di quota usa una riga pesata nel database di fixture. Acceptance e benchmark Foundation di volume/durata non sono stati rilanciati.
