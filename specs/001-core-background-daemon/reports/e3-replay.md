# E3 — replay, cursori e lacune / T077

**Data**: 2026-11-08. **Branch**: `001-core-background-daemon-implementation`.
**Esito**: PASS E3, T073–T077. T001–T077 completati su 87.
Accettazione completa US4 (T078–T080) e V1 restano da eseguire.

## Verifiche

- `npm run typecheck`: PASS.
- `npm run lint`: PASS; confini architetturali verificati.
- `npm test`: **126/126 PASS**, nessun fallimento, skip o cancellazione; 38.846 ms complessivi.
- `node --test dist-tests/tests/acceptance/event-replay.test.js`: **1/1 PASS**;
  durata del test 6.500 ms, runner 6.587 ms. Questi tempi descrivono la prova,
  non misurano i target prestazionali della specifica.
- Contratti: cursore storeId/seq, WRONG_STORE, cursore futuro/malformato,
  CURSOR_EXPIRED con firstAvailable/highWater/nextAction; gap prima e durante
  lo stream conservato fino alla CLI. Bounds non verificabili restano errori di persistenza.
- Race deterministiche: append mentre vengono consegnate pagine di replay,
  handoff replay→live, retention tra pagine, disconnessione e restart reali.
  Timestamp deliberatamente non ordinati non cambiano l'ordine per seq.
- Le prove E2 ordinarie di autenticazione, drain, memoria e isolamento restano verdi.
  Non è stata ripetuta la campagna di performance E2 in questo incremento.

## Ambiente e campioni

Node 26.13.0, macOS 26.3.1 arm64/APFS, TypeScript 6.0.3,
better-sqlite3 13.0.3; schema **2 invariato**, nessuna migrazione richiesta da E2.
Baseline `fbd5b67` con modifiche T077. Misura UTC: `2026-11-08T19:38:30.885Z`.
Campioni: [e3-replay-samples.json](e3-replay-samples.json).

La prova usa un daemon reale, socket UDS autenticato, archivio temporaneo e CLI compilata.
Una fixture core scrive **960 eventi noti** attraverso SQLite/outbox/journal,
in due gruppi da 320 e 640. Non viene introdotto un endpoint pubblico per eventi arbitrari.

| Verifica | Misurato | Esito |
|---|---|---|
| Primo replay parziale | 80 callback invocate, ultimo accettato seq 84 | PASS |
| Checkpoint conservato dal client | seq 75, intenzionalmente precedente | PASS |
| Riconnessione dopo restart | 897 frame; storeId invariato, instanceId diverso | PASS |
| Duplicati tra connessioni | 10, stessa seq e stesso eventId | PASS |
| Sequenza ricostruita | 967/967 eventi, inclusi lifecycle/controllo | PASS |
| Consultazione di riferimento | 5 pagine, highWater 972 | PASS |
| Segmenti prima della retention | 5 | PASS |
| Cursore scaduto offline e online | CURSOR_EXPIRED, nextAction=reread-status | PASS |
| Bounds restituiti dopo nuovo start | firstAvailable 630, highWater 981 | PASS |
| Ripresa scelta dopo lettura status | after 629, 352 eventi contigui fino a 981 | PASS |

La callback numero 80 viene trattenuta: il checkpoint del trasporto avanza solo dopo
l'accettazione della callback, quindi resta all'evento 79. La chiusura locale interrompe
anche questa attesa senza fermare il daemon. Il cursore salvato all'evento 70 produce
dieci duplicati riconoscibili alla riconnessione. L'unione deduplicata corrisponde
esattamente al journal di riferimento; nessuna omissione silenziosa.

Per rendere riproducibile la retention con un carico ridotto, la fixture apre il journal
**a daemon arrestato con stop verificato**, usando lo stesso algoritmo con budget
**131072 byte (128 KiB)**. I segmenti mantengono la dimensione ordinaria.
Il budget di produzione resta **41943040 byte (40 MiB)**. La prova non
attesta una nuova campagna di saturazione del budget di produzione né il carico SC-007.
La lettura offline del cursore scaduto non avvia il daemon. Uno start esplicito precede
la verifica online; il client rilegge status e sceglie esplicitamente seq=firstAvailable-1.

## Meccanismo

La prenotazione dell'osservatore precede la cattura di highWater H, eseguita nella coda
writer dello storage e sotto la serializzazione SQLite. Il pump legge pagine fino a H,
poi effettua una lettura live dal medesimo journal. Wake-up coalescenti e lettura iniziale
coprono anche gli append tra cattura, risposta di subscribe e attivazione del pump.
Nessuna transazione SQL o descriptor del journal sopravvive alla lettura della pagina.

Il pump verifica seq contigue e non usa il tempo civile per ordinamento/dedup. Retention
che supera il cursore chiude con gap esplicito; persistenza non verificabile produce errore.
Backpressure e limite aggregato di 1 MiB per osservatore rimangono quelli di E2.

IPC accetta `after: {storeId, seq}`. La CLI accetta `--after CURSOR`, codifica base64url
senza padding del JSON canonico. Ogni frame CLI espone `cursor`; una pagina espone
`nextCursor` strutturato e `cursor` opaco. Il trasporto espone `lastReceived` dopo la
callback; il cursore server lastSent resta diagnostico e non prova ricezione del client.
Riconnessione, checkpoint durevole del client e dedup sono responsabilità del client.
Nessun retry, reset del cursore o salto automatico dopo una lacuna; nessuna promessa exactly-once.

## Fallimento intermedio e correzione

La prima esecuzione dell'accettazione è fallita dopo circa **5.516 ms**, durante la
retention della fixture, con EVENT_BACKPRESSURE. Un journal appena aperto calcolava
il pendingFloor predefinito di un append vuoto prima del refresh dello storico, usando
quindi il valore iniziale invece di highWater+1. La correzione calcola il default dopo
il refresh; un test ordinario dedicato verifica riapertura, append vuoto, avanzamento
della retention e budget fisico rispettato. Le soglie non sono state cambiate.

La prima riesecuzione corretta è passata (6.571 ms); il gate finale sopra è stato
rieseguito dopo aver aggiunto il controllo sui bounds non verificabili, insieme a tutta
la suite ordinaria. Il fallimento iniziale resta documentato, distinto dal campione finale.

## Uso

Dalla root del repository, leggere una pagina e conservare `data.events.cursor`:

```sh
node dist/cli/main.js daemon events --state-dir "$review_dir" --limit 1 --json
node dist/cli/main.js daemon events --state-dir "$review_dir" --follow --after "$cursor" --json
```

`--follow` senza cursore continua a partire dal highWater corrente. Un cursore scaduto
restituisce exit 2 con bounds e azione; il client decide dopo aver riletto status.
SIGINT/SIGTERM chiudono solo il client. Consultazione offline non inizializza né ripara lo stato.

## Limiti e checkpoint

E3 completa replay e lacune della consegna incrementale AR-003. Non dichiara conclusi
US4 o l'intera feature: test con secondo UID, dieci osservatori/100 eventi al secondo,
1.000 letture, idle e restante matrice V1 restano nei rispettivi task successivi.
Nessuna misura E3 sostituisce i target SC-001–SC-010.
Provider, Agent Runtime, worktree, gestione dipendenze di progetti, pnpm ed Electron
restano fuori scope. Nessun push, merge o pubblicazione. Arresto al checkpoint T077.
