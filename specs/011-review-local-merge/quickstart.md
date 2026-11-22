# Quickstart — Review, Validation & Safe Local Merge

La procedura usa archivi e checkout temporanei con fixture sintetiche. Esiti e gate sono nei report di [validazione](reports/validation.md) e [qualifica](reports/qualification.md). [Piano](plan.md) · [API](contracts/api.md) · [Gate precedenti](../../docs/missing-features-brief.md)

## Prerequisiti

Schema precedente10 con feature cumulative e test fixture controllate; Node e tool pin del repository. Lo start esplicito deve migrare a11; una lettura offline prima dello start deve lasciare l’archivio invariato. Nessuna installazione o login implicito. Port/provider fake nella suite ordinaria; binari reali solo per il gate qualificato.

## Verifica mirata

```sh
npm run build
npm run build:test
npm run typecheck
npm run lint
node --test --test-concurrency=1 dist-tests/tests/{unit,contract,integration}/review-*.test.js
npm run typecheck:desktop
npm run build:desktop
npm run test:desktop:unit
node_modules/.bin/playwright test -c apps/desktop/playwright.config.ts review-flow.spec.ts
```

Per il controllo della rimozione delegata eseguire `node --test dist-tests/tests/integration/workspace-us3.test.js` dopo il build test. Le campagne acceptance e benchmark Foundation hanno checkpoint propri.

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

Comandi, esiti e matrice FR/SC sono in [validazione](reports/validation.md). Pin, profili OS e perimetro delle fixture sono in [qualifica](reports/qualification.md). I gate aperti sono in [readiness](reports/release-readiness.md).
