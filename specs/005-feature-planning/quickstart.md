# Quickstart — Feature Planning & Versioned Approval

Questa è una procedura di futura verifica, non prova già eseguita. Usare copia di archivio/checkout temporanei e fixture sintetiche; non usare il repository utente come banco di mutazione. Prima leggere [plan.md](plan.md), [contracts/api.md](contracts/api.md) e [gate precedenti](../../docs/missing-features-brief.md).

## Prerequisiti

Schema precedente4 con feature cumulative e test fixture controllate; Node e tool pin del repository. Lo start esplicito deve migrare a5; una lettura offline prima dello start deve lasciare l’archivio invariato. Nessuna installazione o login implicito. Port/provider fake nella suite ordinaria; binari reali solo per il gate qualificato.

## Verifica mirata prevista

```sh
npm run build
npm run build:test
node --test dist-tests/tests/unit/feature-state.test.js
node --test dist-tests/tests/contract/feature-api.test.js
node --test dist-tests/tests/integration/feature-schema.test.js
npm run typecheck:desktop
npm run build:desktop
```

I file sono proposti nei task; non dichiarare disponibili prima della loro creazione. Gli altri casi `tests/integration/feature-usN.test.ts` sono eseguiti compilati con lo stesso runner; Playwright seleziona `apps/desktop/tests/e2e/feature-flow.spec.ts`. Usare invocazioni mirate, non acceptance/bench lunghi. `npm run lint` e typecheck core fanno parte del checkpoint.

## Scenari

1. **US1**: Con progetto fixture approvato creare una feature manuale, revisionarla e rileggerla dopo restart; senza approvazione valida non compare alcuna nuova feature.
2. **US2**: Approvare un bundle fixture, ottenere envelope, mutare contesto o piano e verificare che ogni handoff successivo sia rifiutato mentre la decisione storica resta leggibile.
3. **US3**: Provider simulato produce una domanda e una bozza; due turni espliciti conservano risposte/provenance; provider indisponibile lascia utilizzabile il documento manuale.

4. Ripetere una mutazione con stesso UUID/intento; cambiarne il corpo e verificare conflitto. Simulare reply loss, crash pre/post effetto, grant stale, input concorrenti e quota piena: esito interrogabile, nessun duplicato, dati preservati.
5. Chiudere il desktop durante lavoro accettato, riaprire e cambiare archivio con richieste pendenti; verificare ricevute, parity CLI, output come testo e focus/tastiera.

## Qualifica e criteri di arresto

G0: test di confine readonly e schema FeaturePlanningResult con provider sintetico. G1 assistito reale solo dopo004/T028/T050; registrare NOT_RUN/BLOCKED senza impedire la verifica del percorso manuale con fixture.

Atteso locale: tutte le verifiche degli invarianti pertinenti PASS, oppure blocco documentato che impedisce la capability dipendente. Una prova reale assente è NOT_RUN; un gate fallito è BLOCKED/FAIL. Quota, limiti e latenza sono registrati con condizioni, non promesse generali. Non eseguire login/inferenza/remoto reale senza il consenso specifico previsto dal flusso prodotto.

## Evidenze

`reports/validation.md`: comandi/versioni/esiti e matrice FR/SC. `reports/qualification.md`: pin/hash/policy/capability e differenza fixture/reale. `reports/release-readiness.md`: review e tutti i gate esterni ancora aperti. Questi report verranno creati dai task; non sono attestazioni nel planning.
