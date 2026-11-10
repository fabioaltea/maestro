# Research — Project Registry & Local Git Repositories

**Date**: 2026-11-09. Decisioni di progetto, non risultati di implementazione.
Ricerca in parallelo su Foundation e Git; consolidamento sui file attuali e sulle
fonti primarie sotto indicate. Nessun requisito di prodotto rimasto da chiarire.

## R1 — Estendere la Foundation effettiva

**Decision**: stesso daemon, SQLite/worker, autenticazione, lease e journal/outbox.
Ledger registry separato per semantica, non motore operativo separato.

**Rationale**: `src/storage/schema.ts` è schema 2: `operations.action` ammette solo
start/stop/restart e l'indice `single_pending_operation` serializza il lifecycle.
`SQLiteStore.mutate()` coordina stato/outbox in IMMEDIATE e drena dopo commit;
Git non deve occupare quel worker. La sua deadline RPC è circa 2,1 s.

**Alternatives considered**: estendere il lock lifecycle a tutte le operazioni
progetto bloccherebbe inutilmente letture/controllo; secondo DB perde atomicità
dell'outbox; database/provider esterni non servono al carico locale.

## R2 — Git CLI confinata, senza fallback insicuro

**Decision**: porta `RepositoryInspector`, adapter macOS con binario assoluto
`/usr/bin/git` 2.50.1 (Apple Git-155), ambiente allowlisted, argv e builtin allowlisted.
Confinare ogni invocazione con profilo OS che neghi fork di figli, rete e scritture.
Prima scelta da qualificare: `/usr/bin/sandbox-exec` con profilo distribuito da
Maestro, senza dati del repo interpolati come codice del profilo. L'exec iniziale
consente il solo Git verificato; dopo l'ingresso nel sandbox nessun fork/helper.
Il runner è un adapter sostituibile e deve dichiarare capacità effettiva.

**Rationale**: status può eseguire clean/process filters nel confronto index/file.
La catena `ce_compare_data → index_fd/index_mem → convert_to_git → apply_filter`
è visibile nei sorgenti ufficiali
[read-cache.c](https://raw.githubusercontent.com/git/git/v2.50.1/read-cache.c),
[object-file.c](https://raw.githubusercontent.com/git/git/v2.50.1/object-file.c),
[convert.c](https://raw.githubusercontent.com/git/git/v2.50.1/convert.c).
Disabilitare fsmonitor/hooks/extdiff e pulire l'ambiente non risolve da solo FR-017.

Le pagine locali `/usr/share/man/man1/sandbox-exec.1` e
`/usr/share/man/man7/sandbox.7` confermano disponibilità e deprecazione del comando.
Non si presume una garanzia Apple futura o una qualificazione già acquisita.
G1 deve dimostrare il profilo reale su macOS target, incluso helper che tenta di
lanciare lo stesso Git, config sostituita durante probe e side effect esterni.
Se la primitiva non soddisfa il contratto, capacità indisponibile e blocco prima
che Git legga il repository; una soluzione diversa richiede nuovo design/review.
La campagna IP-denied incompleta della 001 non prova questo confinamento.

**Alternatives considered**: soli flag/preflight sono vulnerabili a race; scrivere
un parser Git completo aumenta enormemente lo scope; shadow config/admin-dir non
ha equivalenza dimostrata per worktree, index sparso e refs. App Sandbox richiede
un diverso packaging, non è una sostituzione già verificata per questa CLI.

## R3 — Hardening e stato Git fedele

**Decision**: applicare anche ambiente pulito, optional locks/lazy fetch/replacements
negati, configurazione system/global esclusa, hooks/fsmonitor e ricorsione submodule
disabilitati. Profilo completo in [git-inspection](contracts/git-inspection.md).
Preflight config bounded senza includes: driver clean/process o includes non
valutabili rendono lo stato dei file UNKNOWN con errore INSPECTION_UNSAFE; non
eseguire status in quel caso e non simulare clean disabilitando filtri.
Topologia/HEAD/refs verificabili possono comunque consentire la registrazione
completa con osservazione parziale ed errore esplicito; senza prova di identità
non si registra. L'assenza del confinamento impedisce ogni probe.

**Rationale**: il manuale [Git 2.50](https://git-scm.com/docs/git/2.50.0) documenta
ambiente e opzioni; il [config](https://git-scm.com/docs/git-config) distingue
config globale e locale. Non esiste un generico bypass della config locale per
tutti i comandi. Il sandbox contiene eventuali race residue; il parser non scambia
output incompleto o helper bloccato per un'osservazione valida.

**Alternatives considered**: usare output umano fragile; ignorare errori di filtro;
leggere patch/sorgenti; status aggregato di tutti i worktree o submodule.

## R4 — Repository comune distinto dal checkout

**Decision**: UUID progetto indipendente; identità comune composta da canonical
common Git directory e anchor filesystem (volume/device, inode e birthtime
ad alta precisione). Anchor separati per reference checkout e admin Git directory.
Pre/post probe e immediatamente prima del commit ricontrollare topologia/anchor.
La deduplicazione avviene su anchor comune dei soli progetti attivi.

**Rationale**: [rev-parse](https://git-scm.com/docs/git-rev-parse) espone common-dir,
git-dir e top-level. Alias/sottodirectory/main e linked worktree condividono common-dir;
cloni distinti, repo annidati e submodule mantengono identità distinte. Un worktree
utilizzabile con common bare è ammesso, un percorso bare senza checkout no.

Non esiste un UUID Git locale immutabile leggibile senza marker. Gli anchor rilevano
normali replacement di directory, non garantiscono difesa da sostituzioni in-place
operate da un writer ostile dello stesso UID. Non si promette snapshot atomico
mentre Git esterno lavora; cambi osservati provocano incertezza, mai rebind.

**Alternatives considered**: solo path non rileva replacement; remote/HEAD/nome non
sono identità; marker nel repository violerebbe la sola lettura. Ricerca automatica
di checkout alternativi cambierebbe il riferimento approvato.

## R5 — Branch e prerequisiti non bloccanti

**Decision**: unborn/detached sono stati normali. Base omessa al primo import è il
branch HEAD soltanto se locale e risolto a commit; altrimenti null. Base esplicita
non valida è errore. Verify non sceglie mai una base quando prima era null.
Validare solo `refs/heads/<nome>` e il commit, senza revision expression arbitraria.

**Rationale**: chiarimenti A/A e FR-006/008. Il nome unborn non è una ref locale valida;
non confondere assenza di commit con repository corrotto. Un primo commit esterno
aggiorna l'osservazione senza cambiare UUID/configurazione.

**Alternatives considered**: prerequisiti obbligatori all'import e fallback main/master
contraddicono lo spec; remote branch non equivale a branch locale.

## R6 — Persistenza, upgrade e idempotenza

**Decision**: schema 3, upgrade transazionale della sola nuova Foundation su start
esplicito con lease controller e daemon detenute. Ricostruire la tabella store per
il suo CHECK di versione e aggiungere progetti, osservazioni, ledger e catalogo
requestId condiviso con lifecycle. Nessun upgrade readonly o del vecchio Maestro.
Il catalogo garantisce unicità requestId globale per store.

**Rationale**: [SQLite ALTER TABLE](https://www.sqlite.org/lang_altertable.html)
prevede una procedura transazionale per modifiche generali dei vincoli; non usare
writable_schema. Stato, esito e outbox condividono un unico commit. Le transazioni
[IMMEDIATE](https://www.sqlite.org/lang_transaction.html) vanno tenute brevi e
con retry BUSY bounded. Idempotenza controllata prima di rileggere path o revisioni.

**Alternatives considered**: UPDATE del solo numero non soddisfa CHECK; upgrade
readonly inatteso muta lo stato; riusare la tabella operations rompe il lock lifecycle;
riusare requestId fra namespace rende ambigui esiti ed eventi.

## R7 — Recovery, concorrenza e budget

**Decision**: accettare intento prima del probe; 4 probe concorrenti e 32 pending,
nessun legame con connessione client. Deadline complessiva 30 s, cancellazione del
probe anticipata per terminare entro il budget. Git fuori worker/event loop.
ConfigRevision distinta da observationRevision; verifica pubblicata con CAS sul
contesto letto. Dopo crash i pending diventano INTERRUPTED, senza auto-riesecuzione.
Supervisor ausiliario Foundation con lifeline/deadline termina i soli figli propri.

**Rationale**: il transport attuale serializza fino a 8 RPC per socket, massimo 64
connessioni e 1 MiB di buffer. RPC Git da 30 s bloccherebbero controllo/letture sullo
stesso canale. Separare accepted e outcome preserva la reattività. Nessun kill PID
senza ownership verificata; nessuna policy imposta al futuro Agent Runtime.

**Alternatives considered**: transazione aperta durante Git; cancellare al disconnect;
retry automatico dopo crash; scheduler generalizzato per workflow futuri.

## R8 — Contratti ed eventi evolvono in modo additivo

**Decision**: protocolVersion 1 conservata, nuovi metodi projects.*, capacità
`projectRegistryVersion: 1` in status. Client della nuova build aggiornati insieme.
Riutilizzare tipi operation.* con payload scoped project e allowlist estesa;
projectId in payload, requestId esplicito come operationId. Conservare sequenza/journal
Foundation e limiti. Non promettere compatibilità con vecchi binari non negozianti.

**Rationale**: EVENT_TYPES e redattore attuali sono chiusi; nuovi campi non aggiunti
esplicitamente sarebbero scartati. Il codice enqueue può derivare operationId dal
pending lifecycle: per registry bisogna passarlo sempre esplicitamente.

**Alternatives considered**: secondo stream/store rompe ordinamento e recovery;
nuovi tipi senza aggiornamento client causano rifiuti sullo storico; protocollo
interamente nuovo senza un bisogno concreto aumenta il lavoro.

## R9 — Evidenza e gate

**Decision**: nessuna soglia 002 presentata come misura. Conservare failure/timeout
nei campioni. Revisione approvata il 2026-11-10: T082 e T085 aperti sono gate di accettazione
finale/rilascio; prima dello sviluppo 002 sono richieste baseline locale verde e
tracciabilità esplicita delle prove mancanti. G1 e le prove finali producono evidenze nuove.

**Rationale**: report della baseline e Constitution VII/VIII. Test mirati PASS non
sostituiscono l'accettazione completa IP-denied FAIL. Il piano non concede deroghe.

**Alternatives considered**: assumere 001 accettata, riciclare benchmark di altri
carichi o rimandare implicitamente la safety alla futura UI.

## R2 implementation refinement — 2026-11-10

On this Mac `/usr/bin/git` dispatches to the root-owned Xcode Git executable.
Use trusted `/usr/bin/xcrun --find git` outside repositories, validate its fixed
system location and fingerprint, then execute that pinned Git inside the sandbox.
No PATH lookup or repo-configured helper is involved. Git needs read/write access
to `/dev/null` and read access to the root directory for startup: profile permits
that nonpersistent sink and required runtime/repository reads, retaining deny-default
for every persistent write, fork and network operation. Six runner contracts now
pass; full G1 malicious-config and process-lifecycle qualification remains pending.
