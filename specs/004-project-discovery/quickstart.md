# Quickstart e qualifica004 — procedura futura

004 è pianificata, **non implementata**. Non eseguire comandi provider, installazioni, login, setup Keychain o campagne di prova durante questa fase. Gli esempi `maestro discovery` saranno introdotti dai task. Non vengono riproposti benchmark lunghi.

## Prerequisiti

macOS26.3/26.3.1 arm64/APFS, Node26.13.0/npm11.20.0, checkout con001–003. Codex0.167.0 standalone nativa già osservata; hash/versione vanno qualificati G0 prima dell’uso. Un modello espressamente configurato e disponibile sul proprio account; nessuna disponibilità/costo dedotta dall’installazione.

G0 deve passare con fixture sintetiche prima di sorgenti reali. La prova reale successiva richiede consenso esplicito, credenziali ufficiali del provider e repository scratch, non il progetto dell’utente. Se manca l’autorizzazione si continua con test locali dove indipendenti e si registra prova reale NOT_RUN, mai PASS.

## Setup provider — solo quando autorizzato

Configurare il nativeBinary risolto e modello tramite nuova CLI/UI. CODEX_HOME provider dedicata e stabile, non il checkout; Maestro non copia il login corrente. Login esclusivamente ufficiale con keyring obbligatorio, senza auth.json o fallback auto. Comando indicativo futuro da verificare sul pin:

```sh
maestro_codex_home="$HOME/Library/Application Support/Maestro/providers/codex-discovery"
CODEX_HOME="$maestro_codex_home" codex --no-daemon -c 'cli_auth_credentials_store="keyring"' login
```

Il core prepara il profilo privato solo su configurazione esplicita. Se Keychain non disponibile o policy managed incompatibile, correggere il prerequisito supportato o lasciare avvio bloccato; niente estrazione token/permessi allentati. Login ufficiale non equivale a qualifica G0 o autorizzazione di ogni run. [Autenticazione ufficiale](https://learn.chatgpt.com/docs/auth).

## Percorso headless / UI

1. Archivio separato e repository scratch (anche dirty/unborn/conflicted), start esplicito dopo upgrade4 esclusivo; snapshot prima.
2. Provider configure/check, progetto importato e verificato. Apertura pannello Discovery senza invocare il modello.
3. Scope esplicito → preview corpus/file/omissioni/digest → consenso invio/provider → start. Salvare UUID di richiesta/discovery/session/run; query operation se risposta persa.
4. Seguire output/domande. Chiudere UI: sessione continua; riaprire archivio/progetto, rispondere con «Invia e continua». Nuovo run intenzionale, stesso contesto/risposte persistite.
5. Review: CODE/fonti verificabili, USER_CONFIRMED/answerId, HYPOTHESIS/UNKNOWN. Correggere → nuova revisione. Approvare preciso digest/contesto dopo rivalidazione.
6. Eligibility corrente confermata dal core; modificare un file analizzato/untracked/config → nuova query nega idoneità, storico conservato. Nessuna implementazione feature ancora disponibile.
7. Snapshot dopo identico a prima per tutte le azioni Discovery. Cancel/crash: query originale e stato verificato o incerto, nessun run o kill estraneo.

L’intervista su fixture deve lasciare un’informazione realmente non presente nel corpus, per verificare la domanda e la provenienza della risposta, senza pretendere uno specifico testo naturale dal modello.

## Verifiche pianificate

```sh
npm run build
npm run typecheck
npm run lint
npm run typecheck:desktop
npm run build:desktop
npm test
npm run test:desktop:unit
npm run test:desktop:integration
npm run test:desktop:e2e
```

Aggiungere G0 e prova opt-in agli attuali test Node, senza runner nuovo. File previsti:
`tests/integration/discovery-provider-boundary.test.ts` (G0 sintetico) e
`tests/acceptance/discovery-real-provider.test.ts` (una prova reale controllata, non inclusa negli ordinari).
Il comando preciso opt-in e la redazione delle evidenze si definiscono nel task della prova; non iniziare traffico per discovery di capability.

## Gate / evidenze da creare nell’implementazione

| Gate | Prova mirata | Stato ora |
|---|---|---|
| G0 |pin/argv/config, confinamento OS, letture auth/checkout/archivio e exec negati, tool residui, fixture inferenza locale con segreti sintetici |NOT_RUN |
| Schema/context |2→3→4, crash upgrade, reader3 immutato, slot/ledger UUID, symlink/hardlink/growth, archive-inside-repo |NOT_RUN |
| G1 |avvio UI/headless, login Keychain e provider reale opt-in, repository invariato, doppio invio/query |NOT_RUN |
| G2 |intervista/risposta/reopen UI, cancel e crash daemon/host, owner incerto, output limitato |NOT_RUN |
| G3 |provenance/versioni/CAS/UNKNOWN, approvazione soltanto esplicita e idoneità core |NOT_RUN |
| G4 |stale contesto/untracked/membership/HEAD/config, reimport, callback tardive e storico |NOT_RUN |

Report futuri in `reports/{validation,provider-qualification,release-readiness}.md` e campioni redatti. Uno scenario reale completo SC001 basta come qualifica iniziale funzionale; nessuna garanzia di durata LLM/throughput. Budget provider/run e troncamenti verificati con tempo/fault controllati, non aspettando10min. Log contengono IDs/codici/byte/stato, non corpus, risposte, token o stderr.

La prova Keychain non dimostra assenza di tutti gli errori futuri e il fake backend non dimostra un’integrazione reale. Un gate runtime fallito resta BLOCKED. Non promuovere001/T082,001/T085,002/T093 o la review manuale003 con le prove004. Nessun merge/push/pubblicazione da questa procedura.
