# Quickstart — registro locale 002

**Stato al 2026-11-11**: US1/US2/US3/US4 implementate e verificate localmente.
`project add/list/show/verify/update/remove/operation` sono disponibili dopo build. Evidenze e limiti: [US1](reports/us1.md), [US2](reports/us2.md), [US3](reports/us3.md), [US4](reports/us4.md).
E1/E2/E3 e carico/idle V1 hanno evidenze locali: [eventi](reports/events.md),
[performance](reports/performance.md). L’accettazione finale e il gate reale UID/macchina
restano distinti: [acceptance](reports/acceptance.md), [readiness](reports/release-readiness.md).

## Review documentale

Leggere [spec.md](spec.md), [plan.md](plan.md), [research.md](research.md),
[data-model.md](data-model.md) e [contracts](contracts/local-protocol.md).
Controllare gli otto gate costituzionali e mantenere separati design conforme,
target prestazionali e risultati misurati. Il branch dichiarato dalla specifica è
002-project-registry, allineato alla Foundation greenfield. Il selettore
`.specify/feature.json` identifica la feature indipendentemente dal branch di checkout.

Revisione approvata il 2026-11-10: P0 richiede baseline locale verde e branch allineato.
T082/FR-016 e T085 rimangono gate di accettazione finale/rilascio, non dello sviluppo locale.
G1 richiede confinamento Git qualificato: un flag di ambiente o una prova simulata
non autorizzano il flusso reale. Nessuna deroga è implicita in questa review.

## Preparazione

Dalla root reale del repository, usare build e test già disponibili:

```sh
cd /Users/fabioaltea/Repository/maestro
npm run build
npm run typecheck
npm run lint
npm test
npm run test:contract
npm run test:integration
```

Eseguire acceptance e benchmark separatamente, senza sospendere il Mac:

```sh
npm run test:acceptance
npm run bench:foundation
```

Le suite comprendono Foundation e registro. `npm test` esclude acceptance.
Acceptance e benchmark contengono osservazioni idle reali di dieci minuti: non
sovrapporre quei carichi. Il carico SC-002/003 è in
`tests/acceptance/project-performance.test.ts`; campioni completi nei report.
Acquisire versioni Node/Git/SQLite, OS/architettura/filesystem, commit, comandi esatti,
exit code, ambiente di rete negata e percorso dello state-dir temporaneo nel report.
Nessun uso di repository dell'utente come fixture; nessun cleanup di directory non
create dalla prova. Per test distruttivi usare esclusivamente risorse temporanee possedute.

## Percorso manuale su fixture possedute

I sottocomandi seguenti sono implementati; scegliere un archivio e repository di prova.
Definire state-dir e repo fixture con path assoluti prima dei comandi; annotare
requestId, projectId e revisione restituiti, senza copiare segnaposto come valori reali.

1. Avviare esplicitamente il daemon nello state-dir di test. In un archivio schema 2,
   verificare upgrade esclusivo/atomico e conservazione di storeId/event seq.
2. `project add` di un checkout valido; `project show` da secondo client restituisce
   lo stesso ID. Il repository rimane identico nello snapshot comparativo.
3. Importare un alias/sottocartella e un linked worktree dello stesso common-dir:
   EXISTING, stesso ID, stesso reference checkout/nome/base.
4. Registrare un repo senza commit: registrazione completa, UNBORN, has_commits=false,
   base=null/UNCONFIGURED. Creare esternamente il primo commit, poi verify: stesso ID,
   has_commits=true, base ancora null. Nessun requisito Discovery/approvazione implicito.
5. `project update` con revisione corrente cambia solo nome/base. Due client sulla
   stessa revisione: uno vince, l'altro REVISION_CONFLICT e zero effetti.
6. Spostare il reference checkout della fixture, poi verify: progetto conservato,
   checkout UNAVAILABLE, nessun fallback su un altro worktree e nessuna directory ricreata.
7. Stop esplicito, poi list/show/operation: dati storici, nessun daemon avviato o DB mutato.
8. Remove con ID/revisione, ripetere stesso requestId e intento: esito originale.
   Riregistrare con nuovo ID richiesta; ripetere vecchia rimozione: nuovo progetto intatto.

Usare `node dist/cli/main.js` dalla root o un percorso assoluto all'entry point:
un path relativo eseguito dalla home cerca il build nella directory sbagliata.

## Matrice requisiti → prove

| Requisiti | Prove e checkpoint |
|---|---|
| FR-001 | Contratti di ogni comando/metodo e parità CLI/client; US1…US4 |
| FR-002, FR-006 | Empty/unborn/detached, base omessa/esplicita invalida; G1/US1 |
| FR-003, FR-004 | Alias, subdir, cloni, annidati, submodule, main/linked/bare-common e UNIQUE concorrente; US1 |
| FR-005 | Trim, Unicode scalar count 120/121, controlli, nome default invalido, nomi duplicati con selezione ID; US1/US3 |
| FR-007 | Base locale a commit, branch remoto/inesistente/unborn rifiutato; nessun checkout; US3 |
| FR-008 | HEAD/base/commit/file-status nullable, reference esatto e limitazioni; prima commit esterno non seleziona base; US1/US2 |
| FR-009 | Query storiche/live, offline senza scritture/autostart/Git, pagine e store incompatibile; S1/US2 |
| FR-010, FR-011 | Checkout assente, replacement e config/ref/topologia concorrenti, niente rebind; G1/US2 |
| FR-012 | CAS config/remove, verify non cambia config revision, stale verify scartato; US2…US4 |
| FR-013, FR-014 | Catalogo globale, intento diverso, ACK perso, rollback/FULL e crash pre/post commit; S1/US1…US4 |
| FR-015 | Disconnessione dopo acceptance, UI assente, mutation con daemon fermo; US1/US2 |
| FR-016 | Tombstone, repo dirty invariato, nuovo UUID e vecchio retry; US4 |
| FR-017 | Sentinelle hook/filter/fsmonitor/alias/includes/textconv/helper, rete/scritture negate e config race; G1 |
| FR-018 | Auth nel core, role controller non valido, revisioni, categorie/retry/nextAction e codec errori; S1/US1…US4 |
| FR-019 | Atomicità stato/outbox, redazione, replay/gap, stream lento e degradazione; E1/E2/E3/V1 |
| FR-020 | Nessun Discovery/provider/worktree management/pnpm/Electron; architettura e assenza side effect; tutte le storie |
| NFR-001 | Acceptance senza rete/UI/provider, due client; V1 |
| NFR-002 | Timestamp/intervallo, config revision osservata, nessuna garanzia per future operazioni; US2 |
| NFR-003 | 4 probe/32 pending/deadline, repository lento e controllo daemon reattivo; G1/V1 |
| NFR-004 | Segreti/URL/path sentinella, nessun contenuto/stderr nei log/eventi/errori; E1/V1 |
| NFR-005 | Snapshot Git pre/post, optional locks negati, timeout/crash e risorse rilasciate; G1/V1 |

## Campagne misurabili

| Criterio | Campagna e pass richiesto |
|---|---|
| SC-001 | Tutti gli scenari delle 4 storie; 100% import validi senza commit/base e ID conservato dopo primo commit |
| SC-002 | 100 progetti, 1.000 consultazioni, 10 client; p95 ≤500 ms, tutte ≤2 s con dato o errore, anche con probe bloccato |
| SC-003 | 30 import/verifiche, repo fino a 10 branch/100 commit; p95 ≤5 s e ogni tentativo ≤30 s, dalla richiesta iniziale a risultato, inclusi coda e polling |
| SC-004 | 100 retry identici e 20 import concorrenti di alias/checkout; 1 progetto attivo e 0 cambi impliciti |
| SC-005 | ≥30 kill del daemon: almeno 10 import, 10 update e 10 remove, distribuiti prima/dopo commit e prima ack; 0 conferme perse, parziali o duplicati |
| SC-006 | Tutte le fixture safety incluse race/timeout/remove; 0 modifiche Git/sorgenti, helper eseguiti o azioni remote |
| SC-007 | Tutti i casi auth/revisione/ID riusato con diverso intento: 0 effetti, errori/nextAction corretti |
| SC-008 | Restart/repo assente: 100% ID/config confermati conservati; storico distinto e 0 autostart offline |
| SC-009 | Tutte le mutazioni confermate correlate progetto/richiesta, evento durevole o degradazione Foundation esplicita; 0 segreti |

Per ogni campione conservare durata wall-clock monotona, esito, errore e requestId.
Non eliminare timeout/failure dal denominatore. Percentile nearest-rank sui campioni
completi; pubblicare anche error rate, massimo e distribuzione per azione. Non fare
warm-up o retry invisibili: dichiararli e tenerli fuori dalla campagna misurata.
SC-002/003 richiedono anche regressione dei tempi controllo daemon sotto carico.

Fault injection a checkpoint deterministici: admission, probe, prima/dopo commit,
prima ack, outbox drain, worker failure, perdita connessione, stop e recovery.
Confrontare dati confermati, catalogo, progetti attivi, esiti e sequenze eventi.
Per crash con outcome ignoto, prima query/retry stesso ID: non generare un nuovo intento.

## Evidenze e gate finali

Report separati per Git safety/confinamento, upgrade/recovery, acceptance e performance,
con tutti i fallimenti e NOT_RUN visibili. Continuare i report Foundation senza
riscrivere un gate aperto come PASS. Documentare capacità/limitazioni effettive,
misurare idle Foundation e attività registry separatamente. Rilascio non pronto
finché uno dei gate obbligatori rimane aperto; questa guida non autorizza esecuzione
codice, task generation o pubblicazione.


Piattaforma qualificata: macOS 26.3 arm64/APFS, Node 26.13.0, Git Xcode 2.50.1.
Schema 2 noto: solo lo start esplicito migra a schema 3 con entrambi i lease; una
query offline non migra. Schemi sconosciuti, corruzione o identità non provata non
vengono riparati automaticamente. Le osservazioni riguardano il primo checkout
confermato e non i contenuti interni dei submodule. LIVE riguarda il registro;
le osservazioni restano datate LAST_KNOWN.

Per un retry conservare requestId e intento originale: un timeout non autorizza
un ID nuovo. Revisioni obsolete richiedono rilettura e intento esplicito. Rimozione
significa sola tombstone del registro, mai cleanup di file/branch/worktree. Dopo
reimport l’ID è nuovo e una vecchia rimozione non lo può colpire. Codici/exit e sintassi
completi sono nel [contratto CLI](contracts/cli.md) e nel [README](../../README.md).
