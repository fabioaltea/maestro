# Quickstart 013

Al primo avvio usa **Collega Codex** se Maestro rileva una CLI compatibile e l’account non è ancora collegato. Completa l’accesso nel browser aperto dalla CLI. Riaprendo Maestro, la verifica riutilizza la sessione del profilo dedicato. Puoi anche aprire o creare un repository prima di collegare l’account.

Apri **Analizza codebase** per far verificare a Maestro la disponibilità di Codex per Discovery. Il primo setup usa il modello `gpt-6.1-sol` se l’archivio non ha un provider configurato. **Diagnostica** mostra versione, percorso e configurazione avanzata. Prima dell’invio, rivedi e conferma l’anteprima delle fonti.

La prima icona della barra laterale apre **Panoramica** nel repository o **Recenti** nella schermata di selezione. Le altre icone sono abilitate solo nella vista del repository. L’ingranaggio in fondo alla barra apre **Impostazioni repository → Generali**, dove puoi verificare il repository, modificare la configurazione o rimuovere il progetto dal registro. Le altre schede sono **Workspace**, **Ambiente**, **Sessioni**, **Coda** e **Revisioni**. Da **Panoramica**, scegli **Chiudi repository** per tornare a **Recenti**: il repository rimane nell’elenco, ma non viene riaperto automaticamente al prossimo avvio.

Le funzioni globali, tra cui **Diagnostica**, **Servizio** e **Profili agente**, sono disponibili nel menu nativo **Strumenti** anche senza un repository aperto.

In **Panoramica**, il README occupa la colonna principale e mostra direttamente il contenuto, senza un titolo aggiunto da Maestro. La data dell’ultima modifica locale e l’ultimo commit del README (se presente) si trovano sotto il documento.

Per rileggere lo stato del repository dopo modifiche esterne, chiudilo da **Panoramica** e riaprilo da **Recenti**.

Nella sezione **Feature**, l’elenco mostra il titolo e lo stato di ogni voce salvata. Il pulsante **+** in alto a destra apre la chat per una nuova feature. La chat occupa tutta l’area di lavoro. Scorrono solo i messaggi e i dettagli della specifica; il campo di risposta resta in basso. La barra laterale rimane disponibile per passare ad **Agenti**.

1. Con un profilo isolato, avviare Desktop e verificare «Apri repository» e «Crea repository». Aprire un checkout locale e verificare il progetto. Ripetere su una cartella vuota con creazione e controllare il checkout senza commit.
2. Selezionare «Analizza codebase». Con il provider di fixture confermare fonti, svolgere la revisione e approvare. In «Feature», «Nuova feature» apre la chat: scrivere la richiesta, salvarla e, con un provider qualificato, confermare «Avvia intervista». Le domande dell’agente compaiono nella conversazione e si risponde dal campo in basso. Il turno attivo o in attesa di risposta è riapribile da «Agenti»; gli scambi già mostrati restano visibili mentre il dettaglio del repository è aperto, ma non costituiscono uno storico persistente della chat. Il documento si trova in «Specifica, piano e approvazione». «Creazione manuale» resta disponibile per il flusso JSON. Ripetere con approvazione obsoleta e verificare il blocco del salvataggio.
3. Alternare due repository omonimi, riaprire Desktop e confrontare recenti e storico. Interrogare un’operazione anche via CLI. Provare l’annullamento e una risposta tardiva.
4. Con il default isolato e vuoto, recuperare da Diagnostica un archivio precedente compatibile e inattivo. Verificare stessa identità e stessi esiti. Ripetere con default pieno o archivio sorgente in uso e verificare il blocco.

```sh
npm run build
npm run build:test
npm run typecheck
npm run lint
npm run typecheck:desktop
npm run build:desktop
npm run test:desktop:unit
```

Le verifiche con utenti e picker nativo sono registrate separatamente dalle fixture. Gate reali precedenti invariati.
