# Modello dati 013

| Entità | Identità e vincoli |
| --- | --- |
| Progetto | `projectId`, identità Git canonica, checkout di riferimento, config revision. Alias equivalenti riusano l’ID. Cloni distinti restano indipendenti. |
| Operazione ingresso | UUID, intento normalizzato, discriminante open/create, destinazione, esito e progetto. Ripetizione dell’intento recupera il risultato. Stesso UUID con intento diverso fallisce. |
| Scope Desktop | Store, progetto attivo e generazione. Il cambio invalida letture e conferme pendenti. Le ricevute originali sono durevoli. |
| Recenti | ID progetto e ordine di apertura, con consultazione del registro autorevole prima di mostrare i dettagli. |
| Riferimento di recupero | Destinazione predefinita, archivio sorgente verificato, identità dello store e prova della directory. Un solo riferimento con pubblicazione esclusiva. |
| Contesto approvato | Progetto, revisione Discovery, approvazione e stato di idoneità corrente. La UI usa l’esito del core. |

Creazione ammessa → inizializzazione confinata → ispezione → commit del registro. Un’interruzione conserva i file e l’operazione. La riapertura verifica il repository prima di collegarlo.
