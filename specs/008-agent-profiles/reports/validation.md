# Validazione 008

## T001 — baseline

20 novembre 2026. Base `0d7f577` di 007, writer SQLite schema 7, Node 26.13.0, npm 11.20.0, macOS 26.3.1 (a) arm64/APFS. Checklist requisiti 16/16. La baseline 007 riporta 81 casi core verificati, 51 test desktop unit/contract, 32 integrazioni e 2 flussi Electron. [Validazione 007](../../007-workspace-environments/reports/validation.md)

001/T082 NOT_RUN e T085 FAIL/OPEN, 002/T093 BLOCKED, 003/T054 REVIEW_PENDING, 004/T028 e T050 BLOCKED da PROVIDER_UNSAFE. 005 G1 dipende dal gate reale 004 e conserva la flake UPDATE replay 61 vs 60. G0 008 usa dati locali sintetici per parser/resolver/import. Identità e contenuti dei tool restano dati di configurazione. [Readiness 007](../../007-workspace-environments/reports/release-readiness.md)

## T002 — casi negativi iniziali

Fixture passiva con marker di esecuzione, origine sostituita, link, traversal, allegati eseguibili e limiti di byte/UTF-8. Verifica RED prima dell’adapter.

## T003 — reader di import

Reader macOS in processo effimero con policy SBPL default-deny, apertura no-follow e controllo di UID, hard link, identità, UTF-8 e limiti. L’adapter fake restituisce snapshot sostituibili. Il test usa la directory canonica della fixture anche quando TMPDIR contiene l’alias macOS `/var`.

## T005–T007 — stato e migrazione

Grant legati a scope e revisione con scadenza e replay esatto. Upgrade 7→8 sotto lease control/daemon, verifica integrità e FK, compatibilità reader 7 e conservazione del ledger. **10 PASS** su stati, migrazione, fault pre/post commit e regressione schema 7.

## T008 — writer e quota

Namespace PROFILE nel ledger comune. La scrittura atomica collega revisioni e preview agli artefatti sigillati e addebita la stessa quota del workflow. Le verifiche includono rollback senza consumo del grant se manca il file.

## T009–T010 — storico confinato

DTO chiusi per metodi, intenti, pagine e chunk. Reader readonly nello stesso archivio con verifica di store, scope e revisione del cursore. Il test di storico conferma file e inventario invariati. Regressione trovata e corretta nell’allowlist schema Discovery, così stop continua a funzionare su 8.

## T011–T012 — runtime ed eventi

Il daemon pubblica le sole capability composte. Runtime fenced prima del drain, massimo otto chiamate in corso, letture storiche separate dalla composizione. Il writer emette metadati profilo nella stessa transazione. **5 PASS** mirati su runtime, redazione, storico, protocollo e replay con conteggio riferimenti.
