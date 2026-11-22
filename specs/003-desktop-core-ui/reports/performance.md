# Misure desktop003

Ambiente2026-11-15: macOS26.3.1 arm64/APFS, Node26.13.0 esterno,
Electron45.3.0 (Node24.22.2), React19.3.1. Baseline core integrato:
72381375dcc31b54dcebf05666a0d7b4ab9c8ef3, più reader bounded T020.
I campioni sono misure locali, non garanzie generali. p95 nearest-rank.

## Eventi — SC-005 ridimensionato dall’utente

[Campioni reali](event-core-samples.json):10 registrazioni CLI reali,20 eventi,
10853ms di operazioni; p95 disponibilità sulla pipe di riferimento→commit DOM2ms,
massimo4ms. La UI mantiene i controlli da tastiera utilizzabili durante le operazioni.
Clock Date.now con risoluzione millisecondi; due client ricevono lo stesso evento
con scheduling indipendente, perciò i delta firmati possono essere negativi.
Il dato non misura tempo dal commit SQLite né throughput massimo del core.

Test mirati: backlog massimo256KiB, un batch32eventi/64KiB, ACK2s; ACK errato e
mancante non avanzano il checkpoint e chiudono soltanto il client. FIFO500/4MiB,
duplicati, buchi, callback fallita, replay e retention scaduta coperti separatamente.
E1/E2/E3 e questi test costituiscono G4 per lo scope corrente.

## Prove di volume rinviate, non PASS

La precedente proposta100eventi/s per10min/1000latenze è stata rimossa dai gate
su richiesta esplicita dell’utente2026-11-15: il brief richiede osservabilità,
non quel dimensionamento. Nessun produttore sintetico viene mantenuto nella feature.

Prima prova lunga: FAIL dopo circa4,6min per chiusura inattesa della finestra;
causa non diagnosticata, teardown Playwright oltre budget. Una prova breve di
riavvio è stata interrotta prima di separare i carichi; la successiva campagna è
stata interrotta su richiesta di riduzione dello scope. Nessuna è prova di stabilità
prolungata. Eventuali indagini e benchmark di durata restano rinviati; questo limite
non viene cancellato né promosso a PASS.

## Consultazione — SC-001/002

[Campioni UI003](view-performance-samples.json): archivio100progetti,30 processi
Electron distinti con cache filesystem calda,30 selezioni live e30offline.
Tempo apertura conservativo: da prima dello spawn Electron fino alla prima pagina
utilizzabile, include startup e interazione automatizzata col picker (il risultato
viene fornito appena il bootstrap è pronto). È un limite superiore al tempo dalla
creazione finestra; il tempo umano nel picker non è misurato. Dettaglio: da click a
article pronto, inclusi dispatch/attese Playwright. Nessuna misura002 riciclata.

| Modalità | n | p95 ms | max ms | target p95 ms |
|---|---:|---:|---:|---:|
| Apertura | 30 | 1074.85 | 1756.33 | 2000 |
| Dettaglio live | 30 | 236.27 | 244.38 | 1000 |
| Dettaglio offline | 30 | 359.91 | 847.73 | 2000 |

PASS sul campione.100progetti enumerati senza omissioni/duplicati. Freschezza
corretta e osservazioni storiche in tutti i60dettagli; snapshot archivio offline
invariato. Primo campo nullable trattato dal decoder/test null, non convertito in clean.
