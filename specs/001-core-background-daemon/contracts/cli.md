# CLI contract — v1

Comandi pianificati per la futura implementazione. Nessun comando qui è stato eseguito.
Entry point compilato: `node dist/cli/main.js`; alias installato: `maestro`.

## Sintassi

| Comando | Risultato |
|---------|-----------|
| maestro daemon start | Avvia o segnala già operativo; mai conferma al solo spawn |
| maestro daemon status | Stato vivo o ultimo noto; nessun avvio implicito |
| maestro daemon stop | Arresto verificato oppure blocco motivato |
| maestro daemon restart | Un'operazione persistente stop + nuovo avvio |
| maestro daemon diagnostics | Versioni, health, risorse incerte, errori e azione suggerita |
| maestro daemon operation REQUEST_ID | Esito corrente/storico della richiesta, anche senza daemon |
| maestro daemon events | Consultazione paginata degli eventi conservati |
| maestro daemon events --follow | Streaming live; --after CURSOR abilita replay e poi live |
| maestro --help / --version | Aiuto e versione locali, senza accesso scrivente |

Opzioni comuni: `--state-dir ABSOLUTE_PATH`, `--json`.
Mutazioni: `--request-id UUID` opzionale; generato se assente, sempre incluso nei risultati.
`--timeout-ms` può ridurre la deadline, mai aumentare i massimi della specifica:
status 2.000 ms, stop 10.000 ms, altri comandi di controllo 30.000 ms.
Eventi: `--after CURSOR` e `--limit 1..1000`, default 100, massimo pagina 64 KiB.
Il cursore è la codifica opaca base64url senza padding del JSON canonico
`{"storeId":"UUID","seq":"DECIMALE"}`: non è un timestamp. Usare il campo `cursor`
della pagina o del frame ricevuto come valore di `--after`. La pagina espone anche
`nextCursor` strutturato; il client streaming espone `lastReceived` solo dopo
l'accettazione della callback. Un gap conserva firstAvailable/highWater e
nextAction=reread-status, con exit 2; non attiva retry, reset del cursore o
riconnessione automatica. Dopo aver riletto status, il client può scegliere
esplicitamente un cursore con seq=firstAvailable-1 per il solo storico conservato.
Nessun --force, reset, shell, avvio ausiliari o comando provider.

## Output ed esiti

Output umano in italiano, messaggi brevi e nextAction per gli errori. JSON è una singola
risposta v1 senza testo extra su stdout; --follow emette un frame JSON per riga.
Gli errori in --json mantengono lo stesso envelope su stdout; stderr è riservato a guasti
del launcher prima che sia possibile costruire un envelope, senza segreti.

Campi comuni: protocolVersion, requestId?, storeId?, instanceId?, result, outcome,
freshness, liveness, data, error?, nextAction?. I campi non applicabili sono null,
mai un ID inventato per un archivio inesistente. La richiesta generata dal client può
essere annunciata su stderr nel modo umano prima dell'invio per consentire il retry.

| Exit code | Significato |
|-----------|-------------|
| 0 | Richiesta riuscita, incluso no-op; status/diagnostics letti correttamente anche se il servizio è arrestato o BLOCKED |
| 2 | Sintassi, schema, versione o payload non valido |
| 3 | BUSY/IN_PROGRESS: operazione già in corso, non fallita |
| 4 | BLOCKED: intervento richiesto, nessuna promessa di completamento |
| 5 | DEADLINE_EXCEEDED/UNKNOWN_OUTCOME/servizio irraggiungibile |
| 6 | UNAUTHORIZED o proprietario/percorso non valido |
| 7 | Persistenza, integrità o errore interno verificato |

Il codice di status descrive la riuscita della lettura. Liveness e lifecycle sono nel payload:
exit 0 con lifecycle BLOCKED non equivale a daemon pronto. Un valore storico ha
freshness LAST_KNOWN; indisponibilità di una verifica viva è esplicita.

Lo stesso requestId e lo stesso payload ripetono l'operazione originale. Un nuovo comando
utente dopo una vecchia operazione conclusa usa un nuovo ID. Lo stesso ID con azione,
archivio o parametri diversi è IDEMPOTENCY_CONFLICT, senza effetti.

## Modalità offline

status, diagnostics e operation usano il core inspect read-only se il socket non risponde.
Restituiscono ultimo stato noto e osservazione di liveness separati. Non inizializzano
l'archivio, non fanno recovery mutante, non eliminano socket e non avviano daemon/controller.
Se non esiste alcun archivio: status=ABSENT, freshness=LIVE, lifecycle=null.
Corruzione o permessi negati restano errori espliciti; niente ricreazione vuota.

## Test richiesti

Contratto di sintassi e codici, output umano/JSON concordante, stesso ID riconoscibile,
help offline, timeout senza cancellazione, richiesta non supportata senza mutazione,
follow interrotto senza arresto del daemon. I percorsi con altro UID usano credenziali
di test isolate; non si richiedono permessi amministrativi per la suite ordinaria.
