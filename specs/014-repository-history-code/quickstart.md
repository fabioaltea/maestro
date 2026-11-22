# Quickstart: verifica delle due viste

1. In una fixture già aperta in Maestro, prepara almeno 100 commit, 5 branch, un merge, un tag e 3 worktree, incluso uno scollegato. Apri **Storico Git**: verifica collegamenti, etichette, pagine senza duplicati, salto dal worktree al commit e file del merge rispetto al primo genitore. Ripeti l'apertura 10 volte: almeno 9 entro 3 s.
2. In una fixture con `main`, un branch diverso attivo e modifiche non committate, apri **Codice**. Espandi cartelle, apri due schede, cerca nel file e verifica numeri di riga; sposta `main` esternamente mentre navighi. Prima del refresh tutte le schede leggono il vecchio OID; dopo, solo il nuovo. Ripeti il confronto contenuto/OID su 10 configurazioni di checkout o modifiche.
3. Prova senza rete e con daemon fermo, repository senza commit, `main` assente, link, gitlink, binario, file esattamente a 1 MiB e oltre il limite. Cambia repository durante una lettura ritardata e interrompi una lettura prima del retry. Confronta riferimenti, indici e stato dei file prima e dopo le letture, senza conteggiare le modifiche introdotte intenzionalmente dalla fixture.
4. Esegui i test mirati previsti in [tasks.md](./tasks.md). Registra separatamente il test con 5 utenti: almeno 4 devono raggiungere il commit di un worktree e aprire un file su `main` in 90 s al primo tentativo. Non attribuire esiti PASS a misure non eseguite.

## Verifica locale

Per verificare il layout di **Codice**, lascia un file aperto ed espandi una cartella profonda con molti elementi e nomi lunghi. Il pannello del file non deve spostarsi o ridimensionarsi: scorrono separatamente albero, schede e codice. In una finestra stretta l'albero passa sopra al codice, con un'altezza limitata; **Esplora file** mostra o nasconde l'albero senza chiudere le schede. In **Storico Git**, seleziona un worktree nella fascia sopra al grafo e controlla che il worktree resti evidenziato e che il dettaglio riporti il relativo percorso.

- **PASS**: build Core e Desktop, typecheck Core, lint architetturale; 10 test mirati di contratto/integrazione e 6 E2E nelle suite Storico, Codice e ingresso repository. Lo scenario Codice è stato ripetuto includendo il refresh a daemon fermo.
- **SC-001 parziale**: 56–65 ms, 10/10 prime pagine nel Core su una fixture con 104 commit, 5 branch e 3 worktree. Non equivale a una misura Desktop da apertura vista.
- **SC-002/004 parziali**: fixture automatizzate verificano contenuto fissato al commit e invarianza di riferimenti, indici e file durante le letture testate. Non eseguite 10 configurazioni distinte di checkout.
- **SC-003 non eseguito**: prova con utenti non effettuata.
- **Aperto**: simulazione Desktop di una risposta tardiva durante cambio repository e prova estesa su repository vuoto/worktree non raggiungibili. `typecheck:desktop` segnala ancora il mismatch preesistente della prop `localAnalysis` nella vista Discovery.
