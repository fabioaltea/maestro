# Quickstart 013

1. Con un profilo isolato, avviare Desktop e verificare «Apri repository» e «Crea repository». Aprire un checkout locale e verificare il progetto. Ripetere su una cartella vuota con creazione e controllare il checkout senza commit.
2. Selezionare «Analizza codebase». Con il provider di fixture confermare fonti, svolgere la revisione, approvare e aprire «Nuova feature». Ripetere con approvazione obsoleta e verificare il blocco.
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
