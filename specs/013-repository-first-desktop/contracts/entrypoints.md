# Contratto di ingresso 013

- CLI `maestro project open PATH` e `maestro project create PATH` con `--request-id UUID`, `--state-dir ABS` e `--json`. Usano default privato in assenza di override.
- `project open` riusa REGISTER. `project create` usa una modalità di inizializzazione distinta nell’intento REGISTER. La destinazione è nuova o vuota e l’esito restituisce un `projectId` su successo. `project operation UUID` consulta l’originale.
- Desktop accetta una selezione nativa, un nome di sottocartella per la creazione o ID recenti. La conferma visualizza il percorso della creazione. Percorsi arbitrari del renderer non diventano autorizzazioni.
- Desktop avvia la consultazione del default senza richiedere il percorso e distingue la connessione live dallo storico. Cambio di progetto e operazioni conservano identità e generazione.
- L’analisi apre il flusso 004. La creazione feature usa l’idoneità corrente del core 005 e la stessa selezione.
- CLI `maestro archive location` risolve il percorso interno senza creare dati. `maestro archive recover PATH` verifica una fonte locale compatibile e adotta una sola fonte quando il default non ha dati. La diagnostica offre la stessa operazione con selezione nativa e conferma. Errori e fonte indisponibile rimangono espliciti. L’opzione avanzata `--state-dir` consente di consultare direttamente la fonte storica.
