# Validazione 010

## T001 — baseline

Base `c19db4c`, schema 9. La 009 ha concluso 26/36 task, con 37 test core mirati, 57 Desktop unit/contract e 2 E2E riusciti. Il trasporto Codex app-server ha evidenza G0 limitata alla fixture. Claude rimane PROVIDER_UNSAFE e G1 ufficiale resta NOT_RUN. Il daemon standard della 009 pubblica consultazione e riconciliazione locale.

La 010 eredita 001/T082 NOT_RUN, 001/T085 FAIL/OPEN, 002/T093 BLOCKED, 003/T054 REVIEW_PENDING, 004/T028 e T050 PROVIDER_UNSAFE, 005 G1 BLOCKED e le review umane pendenti. 007 fornisce il runtime di preparazione e validazione. 009 fornisce ledger, stato run e lease di fixture.

Le prove di ammissione usano clock controllato, job e processi brevi esclusivamente su fixture. Restano fuori dalle prove locali login reale, consumo di quota del provider e campagne Foundation di volume o durata. Il lockfile Desktop non tracciato è preservato.

## T034 — verifica locale

- Build e typecheck core e Desktop, build Electron e lint architetturale PASS.
- Suite core scheduler e regressione schema 8→9, 24 PASS, 0 FAIL, 0 SKIP.
- Desktop unit/contract, 58 PASS, 0 FAIL, 0 SKIP. E2E dedicato 1 PASS con consultazione live e offline.
- FR-001–003. Fairness e cap coperti da prove di dominio, SQLite e processo fixture. Il test di riavvio conserva il debit precedente. Le admission native 004/005/007/009 mantengono i loro limiti. La reservation Scheduler osserva i debit attivi già dichiarati nei ledger esistenti.
- FR-004–009. Regole pure verificate su quota ignota, clock indietro, revoca, tentativi, destinatario, checkpoint e costo. Wake da osservazione provider, switch reale e confronto end-to-end ancora aperti.
- FR-010–012. Coda/operation paginate, offline immutabile, migrazione pre/post commit, grant monouso, UUID globali, riserva per annullamento e outbox metadata. Il bridge Desktop della coda espone consultazione.

L'E2E iniziale ha intercettato contesa temporanea sul client dopo la selezione archivio. Il bridge usa il reader comune con retry limitato e scope verificato. Ripetizione PASS.
