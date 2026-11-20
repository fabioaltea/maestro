# Quickstart — Agent Profiles, Skills & Tools

Questa è una procedura di futura verifica, non prova già eseguita. Usare copia di archivio/checkout temporanei e fixture sintetiche; non usare il repository utente come banco di mutazione. Prima leggere [plan.md](plan.md), [contracts/api.md](contracts/api.md) e [gate precedenti](../../docs/missing-features-brief.md).

## Prerequisiti

Schema precedente7 con feature cumulative e test fixture controllate; Node e tool pin del repository. Lo start esplicito deve migrare a8; una lettura offline prima dello start deve lasciare l’archivio invariato. Nessuna installazione o login implicito. Port/provider fake nella suite ordinaria; binari reali solo per il gate qualificato.

## Verifica mirata prevista

```sh
npm run build
npm run build:test
node --test dist-tests/tests/unit/profile-state.test.js
node --test dist-tests/tests/contract/profile-api.test.js
node --test dist-tests/tests/integration/profile-schema.test.js
npm run typecheck:desktop
npm run build:desktop
```

I file sono proposti nei task; non dichiarare disponibili prima della loro creazione. Gli altri casi `tests/integration/profile-usN.test.ts` sono eseguiti compilati con lo stesso runner; Playwright seleziona `apps/desktop/tests/e2e/profile-flow.spec.ts`. Usare invocazioni mirate, non acceptance/bench lunghi. `npm run lint` e typecheck core fanno parte del checkpoint.

## Scenari

1. **US1**: Creare seed Project Architect/Frontend/Backend/QA/Reviewer/Release Manager come dati, risolvere uno e modificare il profilo verificando lo snapshot storico.
2. **US2**: Importare SKILL.md fixture di tre scope, associare required/recommended, provare alias conflittuale e file sostituito senza eseguire il contenuto.
3. **US3**: Importare ToolManifest locale e MCP fixture, negare capability, revocare tool e controllare che009 riceverebbe solo lo snapshot autorizzato.

4. Ripetere una mutazione con stesso UUID/intento; cambiarne il corpo e verificare conflitto. Simulare reply loss, crash pre/post effetto, grant stale, input concorrenti e quota piena: esito interrogabile, nessun duplicato, dati preservati.
5. Chiudere il desktop durante lavoro accettato, riaprire e cambiare archivio con richieste pendenti; verificare ricevute, parity CLI, output come testo e focus/tastiera.

## Qualifica e criteri di arresto

Nessuna inferenza. Qualificare parser/resolver e import con bundle ostili/symlink/overflow; tool runtime reale non è certificato da ENABLED e viene qualificato in009.

Atteso locale: tutte le verifiche degli invarianti pertinenti PASS, oppure blocco documentato che impedisce la capability dipendente. Una prova reale assente è NOT_RUN; un gate fallito è BLOCKED/FAIL. Quota, limiti e latenza sono registrati con condizioni, non promesse generali. Non eseguire login/inferenza/remoto reale senza il consenso specifico previsto dal flusso prodotto.

## Evidenze

`reports/validation.md`: comandi/versioni/esiti e matrice FR/SC. `reports/qualification.md`: pin/hash/policy/capability e differenza fixture/reale. `reports/release-readiness.md`: review e tutti i gate esterni ancora aperti. Questi report verranno creati dai task; non sono attestazioni nel planning.

## Flusso locale verificato

Aprire **Profili agente** in Electron. Il catalogo mostra le schede **Profili**, **Skill** e **Tool**. Il selettore Progetto imposta lo scope del catalogo. La creazione del profilo richiede alias, nome, ruolo e istruzioni, poi mostra la conferma e la ricevuta. Per risolvere un profilo scegliere un progetto e l’esatta revisione.

Per provare una skill, creare una directory di fixture con `SKILL.md` di testo. Il manifest opzionale `manifest.json` contiene `alias`, `files` e `requiredPermissions`. Il picker mostra la lista dichiarata e il digest. Confermare l’import e associare la revisione come obbligatoria o consigliata nel dettaglio del profilo.

In CLI, il form equivalente per il picker è `profile skill.preview --input-file FILE --request-id UUID`. Il JSON contiene `source`, `scope` e gli ID di progetto o profilo applicabili. Consultare l’anteprima con `profile preview UUID`. Per create/revise o tool import, caricare il bundle con `profile artifact.import --input-file FILE --request-id UUID`, poi inviare l’intento con `profile prepare --input-file FILE`. Il grant monouso è consumato con `profile <azione> --grant UUID --request-id UUID`. `profile operation UUID` e `profile list PROFILE` sono leggibili anche offline. [Validazione](reports/validation.md)
