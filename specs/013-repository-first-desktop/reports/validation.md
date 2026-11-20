# Validazione 013

## Baseline T001

Base 011 `7de6984`. macOS 26.3.1 arm64, Node 26.13.0, Apple Git 2.50.1. Lint architetturale PASS. Le fixture usano uno stato con percorso isolato. I gate di release ereditati restano quelli di 011. Consultare [Readiness 011](../../011-review-local-merge/reports/release-readiness.md).

## Ingresso locale T002–T005

La fixture ha riprodotto il rifiuto della CLI precedente. Il nuovo comando accetta la creazione, avvia esplicitamente un servizio assente, inizializza il checkout senza commit, registra un solo progetto e restituisce l’UUID originale. Un retry stabile riusa il risultato. La conversione dello stesso UUID da create ad open è respinta. Una directory occupata conserva il file locale. La prova usa lo stesso boot, trasporto e probe Git nativo della build standard su una risorsa temporanea.
