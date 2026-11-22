# Contract — Scope, corpus, evidenze e approvazione

## Scope e preview

Input: `{projectId, expectedConfigRevision, selectors:[relativeFileOrDirectory]}`. Massimo16selettori, percorsi relativi NFC senza NUL/traversal/segmenti vuoti; envelope interamente codificato≤32KiB. Nessun absolute path, glob eseguibile o file da aprire ricevuto dal modello. UI propone directory/file consentiti e mostra copertura; l’utente può restringerla.

Inventario con Git Xcode fidato, nuove query chiuse `ls-files -z --cached --others --exclude-standard` e confini del checkout, stesse difese del runner esistente contro hooks/config helpers/fsmonitor/lazy fetch. Non eseguire build/test/scripts del progetto. Scope directory include membership; scope file espliciti non include arbitrariamente il resto del repository.

Esclusioni prima della lettura: .git, .env e varianti (anche template salvo contenuti esplicitamente sicuri da futuro profilo, non in004), chiavi/certificati privati, credenziali, .ssh/.aws/.codex/.claude, cartelle dipendenze/build/cache, ignored, binari, symlink/hardlink/file speciali. Non seguire submodule o repository annidati. Tutti i root canonici archive/runtime/provider-auth di Maestro sono esclusi anche dentro il repository e con nomi non riconoscibili. Nessun override UI che conceda accesso alle credenziali. Un selettore esplicito verso un file escluso fallisce SOURCE_EXCLUDED; in una directory gli esclusi sono omessi e dichiarati nella copertura, senza leggerli. Cambiamenti durante la raccolta fanno fallire il sigillo.

Estrattore in subprocess confinato, root e ancestor identity verificate; no-follow del solo ultimo componente non è sufficiente. Regolari nlink1, UID/identità coerenti col checkout, UTF-8 rigoroso, fstat prima/dopo, byte limit effettivo anche se cresce. TOCTOU o ambito instabile → CONTEXT_UNSTABLE e nessun corpus inviato. No escalation per permessi negati.

Preview legge localmente su intenzione esplicita dell’utente e sigilla una copia privata; niente provider. Restituisce snapshotId/contextDigest/configRevision, count/byte, source relative paths e omissioni sicure (mai elenco file segreti letti). Cap200file/128KiBfile/1MiBtotale; overflow rifiutato, non analisi silenziosamente parziale. L’utente vede cosa verrà inviato PRIMA del grant. Approvazione scope non implica consenso a qualunque futuro file aggiunto.

## Manifest e envelope provider

Manifest privato append-only:

```text
snapshotVersion1; snapshotId; storeId; projectId; configRevision;
repository/checkout anchor; scopePolicyVersion; selectors; inventoryDigest;
headKind/headOid/currentBranch; capturedAt;
sources[{sourceId,relativePath,sha256,byteLength,lineCount}]; contextDigest
```

Il provider riceve solo `{schemaVersion1, instructionsVersion, sources[{sourceId, relativePath,sha256,text}], answers[], questions?[], priorDraft?, requestKind}`. Niente store path, UID, endpoint, credentialRef, repository root assoluta o Git directory. byteLength dell’envelope realmente serializzato≤2MiB e≤cap modello del profilo; controllo prima dell’effetto. Il materiale autorizzato può contenere testo sensibile o path scritti nel codice: non si promette classificazione infallibile di ogni segreto hardcoded; preview e scoping restano espliciti.

## Output strutturato

Un final result è uno di:

- `QUESTIONS`: array≤20 di testo≤4KiB e reason/section target; i questionId autorevoli vengono assegnati da Maestro, non dal modello.
- `DOCUMENT`: sezioni≤20, claim≤200, totale≤256KiB, con titolo, testo e provenance chiusa.

Sezioni obbligatorie: `purpose-and-features`, `architecture-and-dependencies`, `conventions-and-operations`. Dati mancanti possono essere UNKNOWN/NOT_APPLICABLE con motivo; non inventare deployment/stack. Ogni claim ha `kind` e riferimenti:

| kind | Validazione |
|---|---|
| CODE | sourceId presente nel manifest, hash esatto, start/endLine entro conteggio; citazione facoltativa se presente deve corrispondere |
| USER_CONFIRMED | answerId/revision realmente persistiti per questa Discovery; non un ID inventato dal provider |
| HYPOTHESIS | testo esplicitamente ipotesi, mai trattato come prova |
| UNKNOWN / NOT_APPLICABLE | motivo esplicito, eventuale domanda associata |

Provenienza valida non prova semanticamente vera una conclusione del modello: l’utente può correggere/rifiutare. Riferimenti assenti, output malformato/troncato o sezioni mancanti → INVALID/non approvabile. Nessun HTML/Markdown eseguibile, link automatico, richiesta di tool/installazione o comando derivato dal documento.

## Intervista e correzioni

Domande/risposte hanno IDs/revisioni assegnati dal core e durano oltre la UI. `Invia e continua` è un’azione esplicita con grant, answerId e requestId: salva risposta, rivalida contesto, poi crea un solo nuovo run nello stesso logical sessionId. Retry stessoID restituisce precedente esito; risposta differente sullo stessoID → conflitto. UNKNOWN è una risposta intenzionale, non una verifica del codice.

Non si mantiene vivo un processo durante WAITING_USER. Il prossimo run ricompone corpus/risposte/bozza locali e non usa resume proprietario. In questa versione20domande e20run per Discovery, nessun loop infinito. Correzione genera revisione nuova con parentRevisionId; non muta una revisione approvata.

## Freshness e gate core

Confrontare il manifest con nuovo inventario e byte hash degli input letti, HEAD/anchor e configRevision prima di ogni run e approvazione. File aggiunti/rimossi nello scope directory cambiano membership; modifiche fuori da una lista esplicita non vengono spacciate come analizzate. Instabilità/timeout → UNKNOWN, cambiamento → STALE, provider non avviato con contesto diverso.

Approval è un’operazione CAS persistente: revisionId/bundleDigest, stateRevision, configRevision, contextDigest, domande risolte o elenco UNKNOWN accettati, ownerUid. `SUCCEEDED` dell’agente non vale approvazione. Output tardivo resta legato a run/generation/projectId originali. Progetto rimosso/reimportato non riceve le approvazioni precedenti.

Eligibility live avvia una rivalidazione readonly bounded (checkId, CHECKING/eligible=false finché pronta); query col checkId legge lo stesso check corrente, non rilancia. Max1check per progetto/4globali senza coda, risultato con checkedAt e TTL30s; una nuova richiesta senza checkId crea un controllo nuovo. Gli esiti sono fotografie, non permessi riutilizzabili: futura API feature dovrà rifare il confronto immediatamente prima dell’uso. Offline/errore/storico non equivalgono a eligible=true. Non si pretende atomicità fra working copy esterna e commit DB.

T031: nei turni ANSWER, questions contiene le domande core bounded con
questionId/revision/testo/stato per interpretare la storia answers. Le risposte
vengono salvate con grant prima del lavoro asincrono; mismatch/errore non le
cancella e non riavvia automaticamente il provider.
