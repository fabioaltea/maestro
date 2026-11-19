# Validazione 007

## T001 — baseline e dipendenze

19 novembre 2026, branch cumulativo `007-workspace-environments-implementation` da `c536337`. Schema 6 e primitive Workspace della 006 disponibili. La baseline mirata 006 ha 50 PASS core, 48 unit/contract desktop, 13 integrazioni desktop e 1 E2E. Node 26.13.0, npm 11.20.0, macOS 26.3.1 (a) arm64/APFS. Prerequisiti Spec Kit presenti e checklist requisiti 16/16. [Validazione 006](../../006-git-workspaces/reports/validation.md)

La prima qualifica usa pnpm installato localmente e un registro HTTP su loopback con pacchetti sintetici. Le prove non usano account, login, registry esterni o progetti utente. Schema 7 sarà accessibile soltanto dopo upgrade esplicito. Il profilo del processo e la release proof della lease derivano da evidenze di questa feature.

Restano aperti 001/T082 NOT_RUN e 001/T085 FAIL/OPEN, 002/T093 BLOCKED, 003/T054 REVIEW_PENDING, 004/T028 e T050 BLOCKED da PROVIDER_UNSAFE e G1 reale 005 BLOCKED. La review 006 ha lasciato invariati questi gate. Nessuna ripetizione automatica del flake UPDATE replay 61 vs 60. [Readiness 006](../../006-git-workspaces/reports/release-readiness.md)

## T003 — primitiva pnpm macOS

Porta neutra e adapter con pin del binario Node e dell’intera distribuzione pnpm, due root private, politica SBPL su file/processi/rete, input frozen e output bounded. Il processo osservato è l’unico che il profilo può eseguire. Cancellazione tramite handle del figlio e attesa di chiusura. La fixture qualifica anche config ambientale ostile e redirect HTTP verso altro endpoint. Build, build:test, lint e **4 PASS** in integrazione.

## T005 — test iniziali

Tre RED prima di modello e namespace, con stato manuale/stale, generazioni, limiti e scope dei grant.

## T006 — test iniziali

Quattro RED prima dell’upgrade 6→7. Reader immutabile, putative fault pre/post commit e collisioni in entrambi i versi.
