# Validazione 008

## T001 — baseline

20 novembre 2026. Base `0d7f577` di 007, writer SQLite schema 7, Node 26.13.0, npm 11.20.0, macOS 26.3.1 (a) arm64/APFS. Checklist requisiti 16/16. La baseline 007 riporta 81 casi core verificati, 51 test desktop unit/contract, 32 integrazioni e 2 flussi Electron. [Validazione 007](../../007-workspace-environments/reports/validation.md)

001/T082 NOT_RUN e T085 FAIL/OPEN, 002/T093 BLOCKED, 003/T054 REVIEW_PENDING, 004/T028 e T050 BLOCKED da PROVIDER_UNSAFE. 005 G1 dipende dal gate reale 004 e conserva la flake UPDATE replay 61 vs 60. G0 008 usa dati locali sintetici per parser/resolver/import. Identità e contenuti dei tool restano dati di configurazione. [Readiness 007](../../007-workspace-environments/reports/release-readiness.md)

## T002 — casi negativi iniziali

Fixture passiva con marker di esecuzione, origine sostituita, link, traversal, allegati eseguibili e limiti di byte/UTF-8. Verifica RED prima dell’adapter.
