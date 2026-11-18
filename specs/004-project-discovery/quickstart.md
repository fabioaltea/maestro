# Quickstart004 — implementazione locale e qualifica reale bloccata

Stato2026-11-18: avvio, output, intervista, correzioni, review, approval, freshness e
storico implementati nel core e nei client. G0 sintetico e G2/G3/G4 locali su fixture
qualificati; G1/SC-001 reale **BLOCKED** nel precheck Keychain (`PROVIDER_UNSAFE`),
prima di qualsiasi inferenza. T028/T050 restano aperti. Consultare
[validation](reports/validation.md), [provider](reports/provider-qualification.md),
[readiness](reports/release-readiness.md) e [status redatto](reports/real-provider-status.json).

## Prerequisiti e avvio

Piattaforma qualificata: macOS26.3/26.3.1 arm64/APFS, Node26.13.0/npm11.20.0.
Stesso daemon e writer001/002; Electron45.3.0 è client. Dalla root:

```sh
npm run build
npm run build:desktop
npm run desktop
```

Un archivio dati può contenere più progetti registrati, ognuno collegato a un
repository Git separato. Aprire la UI o interrogare l’archivio non avvia il daemon.
Start esplicito aggiorna esclusivamente gli schemi noti2→3→4 sotto lease esclusivi;
le letture non inizializzano né aggiornano. Conservare storeId/projectId/requestId.

## Provider e login ufficiale

Binario standalone Codex0.167.0, SHA256
`030316ecfbb41f4e7946e584b0063ef333b7a36cd312ba349f2f6869e39b62cc`;
profilo/schema qualificati in G0. Un altro pin/profilo richiede riqualifica.
Dalla UI scegliere il binario nativo e configurare il modello. L’utente ha scelto
Sol6.1, ID `gpt-6.1-sol` secondo la [documentazione ufficiale](https://learn.chatgpt.com/docs/models?surface=cli).
La disponibilità dell’account non è dedotta dal catalogo.

Maestro prepara esplicitamente il profilo privato
`~/Library/Application Support/Maestro/providers/codex-discovery`.
Il login è un’azione distinta nella CLI ufficiale, con `CODEX_HOME` dedicato,
`cli_auth_credentials_store="keyring"` e metodo ChatGPT. Il login ordinario può
appartenere a un’altra identità. Maestro non legge/copia token; non accetta API key,
auth.json o fallback automatico. La modalità keyring ufficiale fallisce se il
credential store OS non è disponibile: [autenticazione](https://learn.chatgpt.com/docs/auth?surface=cli).

**Verifica provider e login** è un controllo locale, non inferenza. Il precheck
reale autorizzato ha restituito UNSAFE/PROVIDER_UNSAFE sul profilo confinato.
Mantenere l’avvio bloccato finché compatibilità Keychain/policy non viene corretta
e riqualificata; la causa non è dimostrata come semplice login mancante.
Nessun profilo ampliato o autenticazione alternativa è stato introdotto per la prova.

## Flusso UI

1. Aprire l’archivio, avviare esplicitamente il servizio, importare un repository.
2. Aprire **Discovery**; il pannello legge soltanto stato. Configurare/verificare
   il provider, indicare1–16 selettori relativi, quindi **Prepara anteprima**.
3. Controllare file, byte, omissioni, digest e scope; il consenso dichiara l’invio
   delle sole fonti sigillate. **Avvia Discovery** richiede una conferma monouso.
4. Consultare output/intervista. Rispondere con **Invia e continua** o **Non so**:
   risposta persistita prima della nuova esecuzione intenzionale, stessi corpus e
   sessione. Chiudere UI non cancella il lavoro.
5. Review delle tre sezioni: CODE con source/hash/righe, USER_CONFIRMED con risposta
   e revisione, HYPOTHESIS, UNKNOWN e NOT_APPLICABLE distinti. La provenance verifica
   i riferimenti, non la verità semantica. Testo e citazioni sono inerti.
6. **Invia correzione** crea un nuovo run e una revisione con parent; la precedente
   resta immutabile. Per **Approva questa revisione**, accettare separatamente ogni
   UNKNOWN/domanda aperta e confermare revisione/digest/contesto esatti.
7. **Verifica idoneità attuale** rivalida il fingerprint. Il true è una fotografia
   con checkedAt/TTL30s, non l’autorizzazione a una feature futura. Un errore o dubbio
   produce false/UNKNOWN; un cambiamento rilevante produce Da aggiornare.
8. **Nuova Discovery** riporta a una nuova anteprima e conferma. Lo storico,
   comprese approvazioni e revisioni precedenti, conserva identità e contesto originali.

## CLI headless

```sh
node dist/cli/main.js discovery --help
node dist/cli/main.js discovery provider get --state-dir /percorso/archivio --json
node dist/cli/main.js discovery list PROJECT --state-dir /percorso/archivio --json
node dist/cli/main.js discovery show DISCOVERY --state-dir /percorso/archivio --json
node dist/cli/main.js discovery revisions DISCOVERY --state-dir /percorso/archivio --json
node dist/cli/main.js discovery document REVISION --metadata --state-dir /percorso/archivio --json
```

Sostituire gli identificativi segnaposto con UUID reali. `questions DISCOVERY`,
`output RUN`, `operation REQUEST` e documenti/storico sono leggibili offline come
LAST_KNOWN. `document REVISION` restituisce chunk≤8KiB e `nextCursor`; usare
`--after CURSOR` fino a null, controllando hash, offset e totale≤256KiB.
`revisions`, `list`, `questions` e `output` hanno pagine≤20 con cursori bound a
store/target/revisione. `eligibility PROJECT` ritorna CHECKING/false con checkId;
`eligibility PROJECT --check-id UUID` interroga lo stesso job/risultato. Senza ID
si richiede una nuova verifica, coalescente se già attiva; max1/progetto/4globali,
senza coda. Offline/restart/scadenza non restituiscono un true cached.

Le mutazioni Discovery hanno admission≤2s e UUID proprio; l’ammissione non attesta
il completamento dell’analisi. `prepare --intent-file FILE` o `--intent-stdin`
richiede l’intento canonico chiuso dei [contratti](contracts/): owner/store/azione/
target/config/state/snapshot/context/provider/profile/model e payload. Il grant
monouso vale5min e vincola esattamente quell’intento. Il client deve presentare il
riepilogo per il consenso prima di inviare il comando col grant.

| Comando | Input privato aggiuntivo |
|---|---|
| `preview PROJECT --expected-revision REV --scope-file FILE` | array JSON selettori; alternativa `--scope-stdin` |
| `start PROJECT --grant UUID` | snapshot/ambito nel grant preparato |
| `answer QUESTION --grant UUID --answer-file FILE` | `{kind:"ANSWER"\|"UNKNOWN",text:"..."}`; alternativa `--answer-stdin` |
| `correct DISCOVERY --grant UUID --review-file FILE` | `{correction:"..."}`; alternativa `--review-stdin` |
| `approve DISCOVERY --grant UUID --review-file FILE` | `{revisionId,bundleDigest,acceptedUnknownIds}`; alternativa `--review-stdin` |
| `cancel DISCOVERY --grant UUID` | solo target e state revision nel grant |

I file contengono JSON valido con chiavi fra virgolette; gli schemi in tabella sono
notazione descrittiva. File/pipe≤32KiB; risposte/correzioni≤4KiB UTF-8. Scope,
risposte e correzioni non viaggiano in argv. `--request-id UUID` conserva l’intento
originale; dopo una risposta persa interrogare `operation REQUEST`, senza un nuovo
UUID per indovinare se il comando è stato eseguito.

## Errori e recovery

| Stato/codice | Significato e azione |
|---|---|
| PROVIDER_AUTH_REQUIRED | login ufficiale del profilo dedicato richiesto |
| PROVIDER_UNSAFE/UNSUPPORTED | compatibilità/policy non qualificata; bloccare l’invio e correggere il prerequisito |
| CONTEXT_CHANGED / Da aggiornare | nuova anteprima e nuovo consenso; storico conservato |
| CONTEXT_UNSTABLE / UNKNOWN | fingerprint incerto; idoneità false, osservazione esplicita successiva |
| UNKNOWN_OUTCOME / RECONCILING | consultare UUID/stato originali; preservare slot/ownership finché l’assenza non è provata |
| WAITING_USER | nessun processo necessario; domanda e risposta persistenti, slot mantenuto |
| INTERRUPTED | storico conservato dopo perdita owner/restart; nessun resume automatico |
| CHECK_EXPIRED | risultato eligibility scaduto o di altro runtime/progetto; nuova verifica esplicita |

Cancel usa solo handle posseduti e prova autenticata di uscita; massimo locale4s.
Un PID persistito non autorizza kill/adoption. Cancellazione remota non verificata.
Output troncato viene segnalato; renderer≤500righe/1MiB, archivio≤4MiB/run,
parser≤8MiB/run. Contesto≤30s, run≤10min, senza garanzie di durata LLM.
Rimozione/reimport genera una nuova identità e non trasferisce approvazioni.

## Verifiche e prova reale opt-in

```sh
npm run build
npm run typecheck
npm run lint
npm test
npm run typecheck:desktop
npm run build:desktop
npm run test:desktop:unit
npm run test:desktop:integration
npm run test:desktop:e2e
```

`npm test` esclude acceptance. Per le sole acceptance Discovery locali, dopo build:test:

```sh
node --test dist-tests/tests/acceptance/discovery-review.test.js dist-tests/tests/acceptance/discovery-refresh.test.js
```

G0 sintetico esplicito: `npm run test:discovery:boundary`, senza account o inferenza
ufficiale. Non usare `test:acceptance` o `bench:foundation` per questa verifica:
contengono campagne idle reali distinte, non necessarie a004.

T028/T050 richiedono consenso esplicito alla prova e login compatibile. Il runner
usa esclusivamente un repository sintetico, disabilita trace/video/screenshot e
registra solo metadata redatti. Comando per un’esecuzione già autorizzata:

```sh
MAESTRO_DISCOVERY_REAL=1 \
MAESTRO_DISCOVERY_REAL_CONSENT=synthetic-scratch-readonly \
MAESTRO_DISCOVERY_REAL_MODEL=gpt-6.1-sol \
MAESTRO_DISCOVERY_REAL_BINARY=/percorso/assoluto/binario/nativo/codex \
node --test dist-tests/tests/acceptance/discovery-real-provider.test.js
```

Prima compilare core/test/desktop. Senza opt-in il runner segnala NOT_RUN; login
assente produce NOT_RUN, incompatibilità di sicurezza produce FAIL/BLOCKED.
Il consenso ricevuto in questa sessione resta registrato nel report; il fallimento
UNSAFE non viene trasformato in PASS o aggirato. G0 e fixture non sono SC-001.

Gate001/T082,001/T085,002/T093 e review umana003/T054 rimangono aperti. Nessun
merge/push/release o fase ulteriore è autorizzato da questa procedura.
