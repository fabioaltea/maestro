# Review manuale desktop — da completare

Stato: **PENDING / review umana parziale**. L’utente ha segnalato un errore durante
la selezione reale di un repository come archivio; la distinzione e il messaggio
sono stati corretti in T060. La campagna manuale completa resta da eseguire. I test Electron automatici restituiscono risultati controllati dei
picker; non costituiscono una review umana del dialog nativo. Non è stata richiesta
né modificata alcuna autorizzazione macOS per automatizzarlo.

Dal checkout, con Node26.13.0, eseguire `npm run desktop` e usare solo archivio e
repository temporanei dedicati alla review:

1. A finestra1280×800, scegliere un archivio esistente con il picker reale. Annullare
   una seconda selezione: l’archivio attivo deve restare invariato.
2. Provare Nuovo archivio → nome → cartella contenitore: selezione non crea dati.
   Avviare soltanto con conferma esplicita nella sezione Servizio.
3. In Importa progetto scegliere un repository locale di prova con il picker reale;
   controllare nome/percorso del riepilogo, Annulla ed Escape, quindi importare.
4. Ripercorrere da tastiera elenco/dettaglio, Verifica, modifica, rimozione della sola
   registrazione, Attività e Operazioni. Verificare focus visibile/ritorno dopo dialog,
   scorrimento, etichette e leggibilità; confrontare gli screenshot automatizzati.
5. Chiudere l’app: daemon ancora attivo. Riaprire, riselezionare archivio, arrestarlo
   esplicitamente. Conservare eventuale esito incerto e interrogarlo in Operazioni.

Registrare data, OS, esecutore, esito e difetti osservati. Finché manca questa review,
SC-006 e T054 non sono completamente qualificati; nessuna dichiarazione di release.

### Riscontro T060

Al primo avvio usare Configura archivio Maestro; Apri archivio riguarda la cartella
dati. Verificare ora che scegliere un repository per errore mostri il percorso
Progetti → Importa progetto conservando la selezione precedente. Per importare
due repository distinti nello stesso archivio usare due volte Importa progetto.
Questo flusso e l’annullamento sono già verificati automaticamente; serve il riscontro
umano con i dialog nativi effettivi.
