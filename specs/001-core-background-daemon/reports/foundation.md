# Foundation checkpoint — T020

**Data**: 2026-11-08
**Branch**: `001-core-background-daemon-implementation`
**Ambito**: F0 e primitive Foundation, task T001–T020.

`npm test`: **30/30 PASS**, zero test saltati o cancellati.
`npm run typecheck` e `npm run lint`: **PASS**.

Sono implementati e verificati dominio/lifecycle, deadline monotone, porte sostituibili,
percorsi e credenziali privati, lease SQLite esclusivi, schema vincolato, worker storage
con commit-before-ack, protocollo UDS autenticato e identità dei processi conservativa.

L'harness usa processi realmente creati dai test e canali IPC privati per shutdown/crash
cooperativi: non termina PID letti dal database. I checkpoint di fault sono definiti solo
nei test e non aggiungono flag pubblici al prodotto.

Questo checkpoint non certifica una CLI/daemon utilizzabile: tale integrazione appartiene
a US1, a partire da T021. Restart, recovery completa, journal/streaming/replay degli eventi,
benchmark di accettazione e test con UID distinti restano da implementare/verificare.
Le soglie SC-001–SC-010 rimangono target; nessun benchmark del daemon è dichiarato PASS.
