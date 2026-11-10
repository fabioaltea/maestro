# Quickstart — Review e futura verifica della 002

**Stato al 2026-11-10**: soli artefatti di design. I sottocomandi project descritti
qui non esistono ancora; nessuna suite di implementazione 002 è stata eseguita.
Le prove seguenti dovranno essere rese eseguibili dai futuri task, senza rete/provider/UI.

## Review documentale

Leggere [spec.md](spec.md), [plan.md](plan.md), [research.md](research.md),
[data-model.md](data-model.md) e [contracts](contracts/local-protocol.md).
Controllare gli otto gate costituzionali e mantenere separati design conforme,
target prestazionali e risultati misurati. Il branch dichiarato dalla specifica è
002-project-registry; il checkout osservato durante il piano era
001-core-background-daemon-implementation a e84e587. Prima della futura implementazione
allineare esplicitamente branch e baseline senza perdere le modifiche di documentazione.

Revisione approvata il 2026-11-10: P0 richiede baseline locale verde e branch allineato.
T082/FR-016 e T085 rimangono gate di accettazione finale/rilascio, non dello sviluppo locale.
G1 richiede confinamento Git qualificato: un flag di ambiente o una prova simulata
non autorizzano il flusso reale. Nessuna deroga è implicita in questa review.

## Preparazione futura

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

Questi comandi esistono per la Foundation; oggi non attestano copertura 002.
I task dovranno aggiungere le prove registry nelle suite pertinenti e un carico
SC-002/003 riproducibile, senza dare per esistente un nuovo script npm.
Acquisire versioni Node/Git/SQLite, OS/architettura/filesystem, commit, comandi esatti,
exit code, ambiente di rete negata e percorso dello state-dir temporaneo nel report.
Nessun uso di repository dell'utente come fixture; nessun cleanup di directory non
create dalla prova. Per test distruttivi usare esclusivamente risorse temporanee possedute.

## Percorso manuale futuro

Comandi esemplificativi **da eseguire soltanto dopo implementazione autorizzata**.
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

## Evidenze da consegnare in implementazione

Report separati per Git safety/confinamento, upgrade/recovery, acceptance e performance,
con tutti i fallimenti e NOT_RUN visibili. Continuare i report Foundation senza
riscrivere un gate aperto come PASS. Documentare capacità/limitazioni effettive,
misurare idle Foundation e attività registry separatamente. Rilascio non pronto
finché uno dei gate obbligatori rimane aperto; questa guida non autorizza esecuzione
codice, task generation o pubblicazione.

## Verifica documentale eseguita — 2026-11-10

PASS: otto artefatti del piano presenti, link locali risolti, blocchi di codice
bilanciati e segnaposto del template assenti. Controllata la presenza nella matrice
di FR-001…020, NFR-001…005 e SC-001…009; review semantica di intenti, revisioni,
crash, deduplica, eventi e limiti tra i contratti. `git diff --check` senza errori.
Lo script `update-agent-context.sh codex` è stato eseguito; il blocco manuale di
AGENTS.md risulta identico a HEAD. Corretta l'attribuzione automatica del piano al
branch di checkout: la nuova voce è riferita alla 002 e dichiarata solo pianificata.

Questi controlli non sono prove runtime: G1 e i criteri SC restano da eseguire,
T082/T085 Foundation restano aperti. Nessun codice, test di implementazione,
tasks.md, commit o cambio branch prodotto da questa pianificazione.
