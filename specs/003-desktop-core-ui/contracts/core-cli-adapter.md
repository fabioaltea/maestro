# Contract — Adapter CLI del desktop

## Confine e comandi

Main Electron→Node26.13.0 assoluto verificato→`dist/cli/main.js`, entrypoint canonico del checkout. `spawn`/`execFile`, `shell:false`, ambiente allowlist, stdio pipe, nessun terminale/shell/command string. Parametri stringa come `--name=VALUE`, `--base-branch=VALUE`, `--state-dir=ABS`, posizionali controllati dopo `--` dove necessario. Mai assemblare una stringa da eseguire. Directory/ID provengono da contesto main/DTO validato; renderer non fornisce binario o args grezzi.

| Azione desktop | CLI |
|----------------|-----|
| stato/diagnostica | daemon status / daemon diagnostics |
| lifecycle | daemon start / stop / restart --request-id UUID |
| ricevuta Foundation | daemon operation UUID |
| elenco/dettaglio | project list --limit=25 [--cursor CURSOR] / project show UUID |
| import | project add ABS_PATH [--name NAME] [--base-branch BRANCH] --request-id UUID |
| verifica | project verify UUID --request-id UUID |
| modifica | project update UUID --expected-revision REV [--name NAME] [--base-branch BRANCH oppure --clear-base-branch] --request-id UUID |
| rimozione registro | project remove UUID --expected-revision REV --request-id UUID |
| ricevuta progetto | project operation UUID |
| storia | daemon events --limit N [--after CURSOR] |
| live/replay | daemon events --follow [--after APPLIED_CURSOR] |

Ogni invocazione include `--json --state-dir ABS`; nessun fallback a directory default se il contesto non è disponibile. L'assenza di base configurata in update usa solo --clear-base-branch; omesso significa invariato. Niente auto Git probe sulle letture.

## Decodifica

Risposte singole JSON UTF-8≤256KiB. Validare versione1, identità request/store/instance, enum, shape distinta per comando e DTO proiettati; no JSON trailing/extra linee. Interi revision/seq conservati stringa. Non fidarsi di `data` arbitrario: campi extra non entrano renderer/log. Gli exit code0/2/3/4/5/6/7 non sostituiscono PublicResult: JSON valido BUSY/BLOCKED/UNKNOWN è un risultato utile anche a exit≠0. Esito terminale è provato dal campo core, mai dall'exitcode solo. Exit anomalo/segnale/overflow/JSONmalformato dopo possibile invio mantiene UUID e UNKNOWN; per sola lettura dà errore sicuro.

Stato envelope `freshness:LIVE|LAST_KNOWN|VOLATILE` e `liveness:LIVE_VERIFIED|ABSENT_VERIFIED|UNKNOWN` sono indipendenti. `data.operation` può essere presente, l'ammissione non equivale al completamento. Decodificare entrambe le forme emesse realmente dalla CLI. Tombstone e observation nullable preservate. Fixture golden devono essere prodotte dalla CLI reale, non inventate dal desktop.

Le query Foundation ID assente possono restituire INVALID_REQUEST, quelle progetto OPERATION_NOT_FOUND. Nessuna delle due dimostra non-invio di una receipt incerta. I timeout core (read2s/control stop10s/start-restart30s/project30s) restano invariati; watchdog main aggiunge margine limitato e non cancella l'operazione accettata.

## Streaming

NDJSON a frame≤64KiB, decoder UTF-8 incrementale e backlog≤256KiB. `subscription.started` stabilisce store/instance/highWater/subscription; frame `event` comprende EventRecord e cursor; `subscription.closed` comprende errore/gap/cursore ricevuto. Usare gli oggetti effettivi di `src/cli/main.ts`; `data.events.cursor` delle pagine storia è il cursore opaco della pagina, non quello di un eventuale evento non ancora applicato.

Storia E1 applicata in ordine e ACK prima di E2 follow `--after lastApplied`. Nessun salto al highWater; se si parte senza storia, il baseline core dichiarato è visibile come inizio della finestra, senza promessa di eventi precedenti. Replay E3 scarta già applicati della stessa store, richiede seqsuccessiva esatta (BigInt), non accetta buchi. LastReceived CLI non è lastApplied UI. CURSOR_EXPIRED/WRONG_STORE impongono stato GAP e rilettura/nuova storia esplicite.

`stdout.pause()` limita la pressione main; batch ACK2s e soglia256KiB chiudono il solo client stream se il consumer non avanza. Perdita connessione = DISCONNECTED, riconnessione solo su azione utente. FIFO renderer≤500/4MiB, conservare il checkpoint indipendentemente dall'espulsione visiva; mostrare il taglio. Core resta libero di chiudere observer lento secondo i propri limiti.

## Ownership e privacy

Nessun import runtime bootstrap/storage/OS core dentro Electron, nessun native module Electron del core, nessun electron-rebuild. Handle ChildProcess sono la sola prova di ownership dei client; non terminare daemon/controller detached, non usare PID ricercati o gruppi di processi. Chiusura UI non invia stop. Lo stderr non è UI/log; errori derivati soltanto da codici allowlist. argv può contenere path scelto dall'utente ma non credenziali, token o contenuti repository. Ricevute private non sono log né autorità core.
