# Quickstart — Owned Git Workspaces

Questa è una procedura di futura verifica, non prova già eseguita. Usare copia di archivio/checkout temporanei e fixture sintetiche; non usare il repository utente come banco di mutazione. Prima leggere [plan.md](plan.md), [contracts/api.md](contracts/api.md) e [gate precedenti](../../docs/missing-features-brief.md).

## Prerequisiti

Schema precedente5 con feature cumulative e test fixture controllate; Node e tool pin del repository. Lo start esplicito deve migrare a6; una lettura offline prima dello start deve lasciare l’archivio invariato. Nessuna installazione o login implicito. Port/provider fake nella suite ordinaria; binari reali solo per il gate qualificato.

## Verifica mirata prevista

```sh
npm run build
npm run build:test
node --test dist-tests/tests/unit/workspace-state.test.js
node --test dist-tests/tests/contract/workspace-api.test.js
node --test dist-tests/tests/integration/workspace-schema.test.js
npm run typecheck:desktop
npm run build:desktop
```

I file sono proposti nei task; non dichiarare disponibili prima della loro creazione. Gli altri casi `tests/integration/workspace-usN.test.ts` sono eseguiti compilati con lo stesso runner; Playwright seleziona `apps/desktop/tests/e2e/workspace-flow.spec.ts`. Usare invocazioni mirate, non acceptance/bench lunghi. `npm run lint` e typecheck core fanno parte del checkpoint.

## Scenari

1. **US1**: In repository temporaneo creare due workspace per due feature, verificare OID di partenza e snapshot del checkout originale invariato.
2. **US2**: Acquisire lease con fixture runtime, tentare secondo writer, perdere owner e verificare che assenza non provata mantenga il blocco.
3. **US3**: Con HEAD già antenato del target, clean e senza holder, rimuovere workspace e poi branch via CAS; dirty/untracked/commit non integrato producono zero cancellazioni.

4. Ripetere una mutazione con stesso UUID/intento; cambiarne il corpo e verificare conflitto. Simulare reply loss, crash pre/post effetto, grant stale, input concorrenti e quota piena: esito interrogabile, nessun duplicato, dati preservati.
5. Chiudere il desktop durante lavoro accettato, riaprire e cambiare archivio con richieste pendenti; verificare ricevute, parity CLI, output come testo e focus/tastiera.

## Qualifica e criteri di arresto

G0 locale con Git reale su repository temporanei, hook/config ostili, path/symlink sostituiti e crash pre/post worktree add; niente repository utente modificato nel planning.

Atteso locale: tutte le verifiche degli invarianti pertinenti PASS, oppure blocco documentato che impedisce la capability dipendente. Una prova reale assente è NOT_RUN; un gate fallito è BLOCKED/FAIL. Quota, limiti e latenza sono registrati con condizioni, non promesse generali. Non eseguire login/inferenza/remoto reale senza il consenso specifico previsto dal flusso prodotto.

## Evidenze

`reports/validation.md`: comandi/versioni/esiti e matrice FR/SC. `reports/qualification.md`: pin/hash/policy/capability e differenza fixture/reale. `reports/release-readiness.md`: review e tutti i gate esterni ancora aperti. Questi report verranno creati dai task; non sono attestazioni nel planning.
