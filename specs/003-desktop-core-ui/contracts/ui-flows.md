# Contract — Flussi e stati della UI

## Shell e navigazione

Singola finestra1280×800, minimo1024×700 con scroll accessibile. Header: archivio selezionato e stato servizio indipendente dalla freschezza dei dati; controllo servizio nel menu dedicato. Sinistra elenco paginato progetti/importazione; centro dettaglio/configurazione; pannello separato Attività/Diagnostica. Nessuna scheda futura agente/sessione/Discovery/merge. Testo locale italiano, asset/font locali, CSS statico.

Primo avvio: scegliere cartella archivio esistente oppure un percorso ancora assente attraverso picker del contenitore+nome archivio validato nel main. L'app spiega che la scelta non crea dati; Avvia inizializza attraverso core dopo conferma. Percorsi non possono provenire da testo eseguibile nel renderer: il main costruisce il percorso da cartella scelta e singolo nome validato senza separatori/traversal. Annullamento mantiene contesto precedente. Non salvare preferenza archivio in questa feature; le ricevute consentono riaprire gli archivi con operazioni sospese dopo conferma di selezione, senza iniziare operazioni.

## Matrice azioni

| Stato | Consultazione | Mutazioni | Attività |
|-------|---------------|-----------|----------|
| LIVE_VERIFIED e core compatibile | live oppure dati osservati datati | azioni offerte dal core e conferme valide | storia + live |
| ABSENT_VERIFIED e archivio leggibile | LAST_KNOWN con etichetta | solo Avvia esplicito | storia, live disabilitato |
| Archivio assente verificato | vuoto “archivio non inizializzato” | solo Avvia esplicito | nessuna storia |
| UNKNOWN / incompatibile / permessi negati | ultimo dato già disponibile chiaramente storico | nessuna, aggiornamento/diagnostica | errore/stream fermo |
| Recovery/block core | stato/diagnostica e query originali | soltanto azioni esplicitamente ammesse dal risultato core; nessun override | storia/stream se disponibile |

“Offline” indica daemon non disponibile, non rete disabilitata. Dopo perdita liveness non lasciare controlli mutativi abilitati sulla precedente osservazione. Ogni invio rivalida lo stato; il risultato core decide, UI non promette disponibilità.

## Operazioni

- **Importa**: picker repository, nome opzionale e base locale opzionale → riepilogo → Importa. Nessun clone/git init/base autodiscovery. Duplicato conduce al progetto registrato senza modifiche implicite.
- **Verifica**: pulsante esplicito, mostra osservazione datata e differenza fra errore del probe e mancato salvataggio. Non abilita workflow futuri.
- **Modifica**: nome e base con tre intenzioni distinte (invariata/impostata/cancellata), revisione visibile nel riepilogo. INPUT_INVALID conserva campi; revision conflict ricarica e richiede nuova conferma, mai autosave/force.
- **Rimuovi dal registro**: conferma nome/ID/revisione e “repository e file conservati”. Se già rimosso, tombstone e elenco aggiornato; niente retry di una vecchia rimozione su progetto reimportato.
- **Servizio**: Avvia intenzionale con archivio; Arresta/Riavvia dialog con effetto su servizio e operazioni. Stato intermedio non è successo. Close finestra termina solo app client.
- **Esito incerto**: mostra UUID, timestamp, azione e Aggiorna esito. Nessun pulsante Ripeti/Forza o eliminazione receipt non terminale. Non equiparare operazione non trovata a invio assente. Incertezza blocca operazioni equivalenti secondo plan; spiega il blocco senza rendere irraggiungibili dati/diagnostica.
- **Attività**: storia prima del live; indicatore connessione/continuità e taglio FIFO. Riconnetti riprende dal cursore applicato; gap richiede rileggere stato e avviare nuova finestra storia esplicitamente. Non riavvia comandi.

## Accessibilità e contenuti

Focus visibile e restituito al trigger dopo dialog; focus trap solo dialog; Esc annulla, Enter non conferma accidentalmente una rimozione. Campi con label/error associato, heading gerarchici, stato via testo+icona e aria-live non invadente. Contrasto testo normale≥4.5:1. Tutti i controlli primari raggiungibili da tastiera a1280×800. Test automatico semantico più review manuale tastiera/contrasto/dialog picker reale; screenshot come evidenza, non unica verifica.

Nomi, path, branch ed errori sicuri vengono resi come testo; niente HTML/raw Markdown, terminale o link eseguibile proveniente dai repository. Nessuna notifica che includa credenziali, raw stderr o contenuto file.
