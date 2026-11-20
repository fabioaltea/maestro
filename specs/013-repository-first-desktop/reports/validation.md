# Validazione 013

## Baseline T001

Base 011 `7de6984`. macOS 26.3.1 arm64, Node 26.13.0, Apple Git 2.50.1. Lint architetturale PASS. Le fixture usano uno stato con percorso isolato. I gate di release ereditati restano quelli di 011. Consultare [Readiness 011](../../011-review-local-merge/reports/release-readiness.md).

## Ingresso locale T002–T005

La fixture ha riprodotto il rifiuto della CLI precedente. Il nuovo comando accetta la creazione, avvia esplicitamente un servizio assente, inizializza il checkout senza commit, registra un solo progetto e restituisce l’UUID originale. Un retry stabile riusa il risultato. La conversione dello stesso UUID da create ad open è respinta. Una directory occupata conserva il file locale. La prova usa lo stesso boot, trasporto e probe Git nativo della build standard su una risorsa temporanea.

## Desktop T006–T011

Le fixture Electron aprono il repository e creano Git in una directory vuota da un profilo privo di archivio. L’analisi mantiene l’anteprima delle fonti, il rifiuto senza provider qualificato e la conferma. Dopo approvazione, «Nuova feature» usa il progetto attivo. Un secondo progetto resta bloccato. Scope e ricevute sono verificati al cambio progetto e al riavvio.

L’adozione headless mantiene percorso originale, identità, esito di registrazione e contenuto del database. Origine con writer attivo e destinazione già popolata sono rifiutate. La perdita del percorso adottato produce un errore. L’interfaccia di Diagnostica esercita la stessa operazione con un profilo isolato e mostra lo storico a servizio fermo.

## Checkpoint T013

- Build core, build test, typecheck core, lint, typecheck Desktop e build Electron PASS.
- 48 test core nel perimetro di ingresso, adozione e contratti del registro, 0 FAIL. Ulteriore check CLI Foundation 2 PASS.
- 67 test Desktop unit/contract, 0 FAIL.
- SC-001. Cinque aperture e cinque creazioni su profili inizialmente vuoti raggiungono «Analizza codebase» in Electron.
- SC-002. Dieci riaperture a caldo di due repository alternati soddisfano la soglia di almeno nove entro 2 s.
- SC-003. L’approvazione valida abilita «Nuova feature» sul progetto associato. Il cambio di progetto blocca la creazione nell’altro progetto.
- SC-004. Le dieci alternanze lasciano due registrazioni e un checkout invariato. Le integrazioni verificano stessa richiesta, intenti concorrenti e fonte storica immutata. Il contratto Desktop scarta la risposta tardiva della selezione precedente.
- E2E Electron. Trenta scenari distinti superati tra la matrice mirata e le regressioni. La matrice iniziale ha rilevato un blocco per slot di lettura nella seconda conferma della modifica progetto. Il preflight ora riusa il retry delle letture con verifica di scope. La riprova isolata e la successiva suite smoke di sette scenari sono PASS.
- SC-003 include anche modifica del file analizzato dopo l’approvazione. L’aggiornamento del repository disabilita «Nuova feature» e «Prepara creazione» finché l’analisi non viene approvata di nuovo.
- La suite di regressione include tastiera, focus, contrasto, attività, privacy, Discovery, planning, sessioni, workspace, coda e review. Le prove di volume delle feature precedenti e i gate reali non sono stati rilanciati. SC-005 e picker manuale NOT_RUN.
