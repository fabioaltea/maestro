# Contract: Core local inspection and Desktop bridge

Il bridge accetta richieste solo dalla finestra che ha aperto `projectId`. Il main Desktop lega handle e cursori opachi alla finestra, al progetto, alla generazione e alla revisione del registro; il renderer non invia un percorso locale, un ref arbitrario o argomenti Git. Il Core carica il progetto dal registro, controlla ancore e revisione, usa un'allowlist di operazioni di lettura e verifica l'appartenenza dei percorsi all'albero e dei commit alla cronologia fissata. La CLI interna riceve OID completi e parametri convalidati, non frammenti di comandi.

| Lettura | Input oltre `projectId` | Esito utile |
| --- | --- | --- |
| `openRepositoryHistory` | nessuno | Handle, riferimenti e worktree osservati, prima pagina del grafo |
| `listRepositoryCommits` | handle, cursore | Fino a 50 nodi con OID e genitori, cursore successivo oppure fine |
| `getRepositoryCommit` | handle, OID, eventuale cursore dei file | Dettaglio immutabile e pagina dei percorsi modificati, con base di confronto; permette il salto al commit di un worktree anche fuori dalla prima pagina |
| `openRepositoryCode` | nessuno | Handle, OID di `refs/heads/main`, prima pagina della radice; `MAIN_MISSING` se assente o senza commit |
| `listRepositoryTree` | handle, percorso relativo canonico (stringa vuota per radice), eventuale cursore | Fino a 100 entry con tipo e cursore successivo oppure fine |
| `readRepositoryBlob` | handle, percorso relativo canonico, eventuale cursore | Tipo, dimensione, chunk fino a 32 KiB prima della codifica e cursore successivo oppure fine; verifica dimensione globale prima di leggere |

L'ordinamento delle pagine è deterministico a snapshot invariato. Il percorso viene trattato come nome Git letterale, non come revisione, pattern o percorso filesystem. Il blob viene ricomposto e validato come testo UTF-8 entro 1 MiB prima di presentarlo; rilevare binari o formati non visualizzabili senza usare processi esterni. Decodifica e rendering non interpretano markup. Niente cache persistente dei dati mostrati. Imporre limiti indipendenti per tempo, byte di risposta e metadati; un limite raggiunto produce continuazione quando supportata, altrimenti errore esplicito, mai un successo completo troncato.

Usare l'envelope di esito esistente, con motivi macchina per dati vuoti, file non supportato (`NOT_TEXT`, `TOO_LARGE`, symlink/gitlink), richiesta invalida o contesto scaduto, oggetti non disponibili, identità cambiata e lettura interrotta. Risultati con `requestId` e `projectId`; niente contenuto, percorsi o output Git grezzo nei log. La UI consente il retry dove applicabile e ignora risposte di generazioni precedenti.
