# Quickstart — Review, Validation & Safe Local Merge

Questa è una procedura di futura verifica, non prova già eseguita. Usare copia di archivio/checkout temporanei e fixture sintetiche; non usare il repository utente come banco di mutazione. Prima leggere [plan.md](plan.md), [contracts/api.md](contracts/api.md) e [gate precedenti](../../docs/missing-features-brief.md).

## Prerequisiti

Schema precedente10 con feature cumulative e test fixture controllate; Node e tool pin del repository. Lo start esplicito deve migrare a11; una lettura offline prima dello start deve lasciare l’archivio invariato. Nessuna installazione o login implicito. Port/provider fake nella suite ordinaria; binari reali solo per il gate qualificato.

## Verifica mirata prevista

```sh
npm run build
npm run build:test
node --test dist-tests/tests/unit/review-state.test.js
node --test dist-tests/tests/contract/review-api.test.js
node --test dist-tests/tests/integration/review-schema.test.js
npm run typecheck:desktop
npm run build:desktop
```

I file sono proposti nei task; non dichiarare disponibili prima della loro creazione. Gli altri casi `tests/integration/review-usN.test.ts` sono eseguiti compilati con lo stesso runner; Playwright seleziona `apps/desktop/tests/e2e/review-flow.spec.ts`. Usare invocazioni mirate, non acceptance/bench lunghi. `npm run lint` e typecheck core fanno parte del checkpoint.

## Scenari

1. **US1**: Creare snapshot da run fixture quiescente, eseguire check locali, cambiare un file e verificare che le prove precedenti diventino stale.
2. **US2**: Su target libero prenotare guard, creare candidate con conflitto o successo; approvare successo, effettuare CAS e fault nei passaggi, verificando OID/prove.
3. **US3**: Integrare fixture, rilevare Discovery stale per cambi rilevanti, richiedere cleanup006 con proof e verificare che lavoro nuovo blocchi la rimozione.

4. Ripetere una mutazione con stesso UUID/intento; cambiarne il corpo e verificare conflitto. Simulare reply loss, crash pre/post effetto, grant stale, input concorrenti e quota piena: esito interrogabile, nessun duplicato, dati preservati.
5. Chiudere il desktop durante lavoro accettato, riaprire e cambiare archivio con richieste pendenti; verificare ricevute, parity CLI, output come testo e focus/tastiera.

## Qualifica e criteri di arresto

Fixture Git reali clean/dirty/ignored/conflict/target movement e hook ostili, fault pre/post CAS e guard sync; nessun merge nel repository Maestro durante planning. Le interferenze arbitrarie same-UID/--force restano fuori dalla prenotazione ordinaria, mai una promessa di isolamento Git.

Atteso locale: tutte le verifiche degli invarianti pertinenti PASS, oppure blocco documentato che impedisce la capability dipendente. Una prova reale assente è NOT_RUN; un gate fallito è BLOCKED/FAIL. Quota, limiti e latenza sono registrati con condizioni, non promesse generali. Non eseguire login/inferenza/remoto reale senza il consenso specifico previsto dal flusso prodotto.

## Evidenze

`reports/validation.md`: comandi/versioni/esiti e matrice FR/SC. `reports/qualification.md`: pin/hash/policy/capability e differenza fixture/reale. `reports/release-readiness.md`: review e tutti i gate esterni ancora aperti. Questi report verranno creati dai task; non sono attestazioni nel planning.
