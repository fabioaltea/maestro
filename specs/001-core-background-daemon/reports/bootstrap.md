# Bootstrap report — T006

**Data**: 2026-11-08
**Esito**: PASS delle primitive di bootstrap; nessun benchmark del daemon eseguito.

| Componente | Valore osservato |
|------------|------------------|
| Piattaforma | macOS 26.3.1 (a), build 25D771280a, arm64 |
| Filesystem del volume di sistema | APFS, verificato con diskutil info -plist / |
| Node | 26.13.0 |
| npm | 11.20.0 |
| TypeScript | 6.0.3 |
| better-sqlite3 | 13.0.3 |
| SQLite runtime | 3.53.4 |

Il driver installato si carica senza downgrade o compilazione locale richiesta.
Il lockfile registra versioni e integrità delle dipendenze risolte.

Tre integrazioni reali passate:

- WAL, synchronous FULL (valore 2), foreign keys, commit e checkpoint TRUNCATE.
- BEGIN IMMEDIATE esclude un secondo processo; il lease torna acquisibile dopo close,
  senza sostituire l'inode del file.
- Uscita del processo senza commit: rollback dello stato non confermato e lock rilasciato.

`npm run test:integration`: 3/3 PASS. `npm run typecheck`: PASS.
I controlli di architettura e il test sandbox erano già passati nel task precedente.
Queste prove non certificano ancora il lifecycle del daemon, la sua recovery o le soglie
SC-001–SC-010: tali verifiche restano NOT_RUN fino ai rispettivi task.
