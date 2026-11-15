# Quickstart e validation — Desktop Core UI

Questa è una procedura prevista: la UI e i comandi desktop **non sono ancora implementati**. Non eseguire installazioni o prove lunghe durante la generazione degli artefatti. Core e relativi report restano lo stato di riferimento.

## Prerequisiti

macOS26.3/26.3.1 arm64/APFS, Node26.13.0 e npm11.20.0 già supportati dal checkout, Git Xcode qualificato per002, dipendenze root installate. Prima implementazione: risolvere i pin del research e i tipi React19 nel lockfile; non ricompilare better-sqlite3 per Electron. Nessun provider o account richiesto. Runtime desktop da verificare con G0; se non compatibile risolvere e documentare il blocco, non disabilitare isolamento.

## Comandi pianificati

Dalla radice `/Users/fabioaltea/Repository/maestro`:

```sh
npm run build
npm run typecheck
npm run lint
npm test
# Questi verranno aggiunti dall'implementazione003:
npm run build:desktop
npm run typecheck:desktop
npm run test:desktop:unit
npm run test:desktop:integration
npm run test:desktop:e2e
npm run desktop
```

`desktop` eseguirà build core/desktop e launcher con Node assoluto corrente; nessun autostart del daemon. Test unit/contract desktop: compilazione Node test separata e runner Node nativo; integrazione Node con CLI reale; e2e tramite Playwright, senza secondo framework orchestratore generico. I test core restano indipendenti da Electron.

## Dati di prova e sicurezza

Usare soltanto directory temporanee create e possedute dal test, archivio e repository scratch (normale, unborn, detached, dirty, conflitti, non accessibile, path con spazi/Unicode/testo ostile). L'harness crea manifest di ownership e snapshot; stop esplicito del solo daemon proprio in teardown, poi rimozione solo fixture possedute. Nessun test opera sul repository dell'utente, sue credenziali o archive default. Dialog nativi sostituiti dall'harness solo tramite API test Playwright; nessun bypass/test flag nel bundle normale. Un giro manuale verifica i picker veri.

## Gate incrementali

- **G0**: Electron avviato da Playwright con sandbox/contextIsolation/preload CJS e protocollo sicuro. Verificare renderer privo di Node/credential, richieste mittente/frame/payload invalide negate, no traversal/rete/navigazioni. CLI Node legge un archivio fermo reale senza caricare moduli SQLite in Electron.
- **G1 / US1**: Da CLI preparare100 progetti; usare elenco e dettagli, interrompere il daemon esplicitamente, ripetere letture. Snapshot archivio prima/dopo modalità offline: nessuna creazione/modifica di DB/sidecar/credenziali; archivio inesistente resta inesistente. Cambiare archivio e far arrivare risposte vecchie, invalidare pagine con client concorrente.
- **G2 / US2**: Dieci cicli Avvia→chiudi UI→CLI status→riapri→Arresta; cronometrare e distinguere successo/blocco/UNKNOWN. Verificare UUID unico a doppio clic, ricevute fsync/ownership/cap100 e fault prima/dopo fsync e spawn, risposta persa, crash main/renderer con operazione accettata superstite, riavvio app e query originale senza nuovo effetto. NO_OPERATION non è prova di non-invio.
- **G3 / US3**: Venti sequenze import/verifica/update/remove e confronto CLI; duplicati, flag null, base keep/set/clear, CAS da secondo client, reimport nuovo UUID, repository dirty/conflitti preservati. Mutazioni offline negate prima dello spawn.
- **G4 / US4**: E1 pagina storia persistita/live-offline; E2 nuovi eventi senza dup al passaggio; E3 disconnect/replay/gap/WRONG_STORE e callback fallita senza avanzamento; E4 consumatore lento/ACK falso o mancante e output eccessivo. Separare test e risultato di ogni incremento.

## Misure SC-001–007

Campagna su Mac sveglio, senza benchmark simultanei. Registrare OS/APFS/architettura, Node/Electron/React, commit/core baseline, cold/warm e load, raw campioni e definizione p95 nearest-rank; non riciclare misure002 come misura UI.

| Criterio | Misura |
|----------|--------|
| SC-001 |100 progetti,30 aperture; da apertura finestra a prima pagina utilizzabile, p95≤2s; enumerazione completa stabile senza duplicati/omissioni |
| SC-002 |30 selezioni live e30 offline, dettaglio pronto p95≤1s/2s; freschezza/flag corretti nel100% del campione |
| SC-003 |10 cicli lifecycle, daemon sempre superstite alla chiusura; stop con esito o indicatore incertezza/blocco≤12s |
| SC-004 |20 sequenze complete, parità CLI e snapshot Git/file100%; fault/concorrenza esiti attesi registrati separatamente |
| SC-005 |almeno10operazioni CLI reali: ordine/identità, navigabilità e p95 disponibilità locale→vista≤1s sul campione; segnale gap/saturazione≤3s, ACK2s e limiti via fault mirati. Benchmark1000eventi e100eventi/s per10min rinviati su richiesta utente2026-11-15 |
| SC-006 |tutti i flussi da tastiera a1280×800; label/focus/error/contrasto automatici dove possibile più review manuale e picker reale |
| SC-007 |tentativi sender/iframe/origine/argv/schema/HTML/rete invalidi tutti negati; nessun segreto nei log, no scritture offline o processi estranei terminati |

La metrica eventi misura la porzione locale client/vista tramite una CLI di riferimento indipendente e osservazione del commit DOM; riportare delta firmati e incertezza di scheduling. Timestamp occurredAt non è un cronometro end-to-end. Nessuna promessa di throughput o stabilità prolungata; campagne di volume/durata rinviate.

## Evidenze e limiti

Creare nell'implementazione `reports/validation.md`, `reports/performance.md`, `reports/release-readiness.md` e campioni JSON/screenshot essenziali, senza segreti. Mappare US/scenari/FR/NFR/SC ai test e agli esiti reali. Test desktop non ancora eseguiti: stato NOT_RUN, mai PASS per checklist documentale.

Regressione build/typecheck/lint/npm test core obbligatoria; contratti/integrazione separati se tocchi invarianti relativi. Non rilanciare benchmark600s o suite accettazione completa senza cambi o dubbi che li giustifichino. I blocchi001/T082,001/T085,002/T093 restano citati come gate di release a parte; test con mock, runner locale o rete normale non li chiudono. App da checkout non equivale a installer/distribuzione pubblica.
