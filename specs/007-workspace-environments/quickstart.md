# Quickstart — Workspace Environments & Dependencies

Usare un archivio temporaneo e un worktree posseduto da Maestro. Lo start esplicito migra lo schema 6 a 7. Le letture offline conservano lo schema esistente e presentano l’ultimo stato noto.

## Verifiche locali

```sh
npm run typecheck
npm run typecheck:desktop
npm run lint
npm run build
npm run build:test
npm run build:desktop
node --test --test-concurrency=1 dist-tests/tests/{unit,contract,integration}/environment-*.test.js
npm run test:desktop:unit
npm exec -- playwright test -c apps/desktop/playwright.config.ts environment-flow.spec.ts
```

La suite avvia fixture pnpm su macOS arm64/APFS con Node 26.13.0, pnpm 9.4.0 e registry HTTP loopback. Il test `environment-boundary.test.js` isola la prova del binario e del profilo nativo. [Qualifica](reports/qualification.md)

## Piano e attestazione

Nel desktop aprire **Workspace**, selezionare **Apri ambiente** e confermare **Prepara piano d’ambiente**. La CLI espone le stesse operazioni. Eseguire i comandi dalla radice del repository con `ARCHIVE`, `WORKSPACE` e `WORKSPACE_REVISION` valorizzati per la fixture.

```sh
node dist/cli/main.js environment plan "$WORKSPACE" --expected-revision "$WORKSPACE_REVISION" \
  --request-id "$PLAN_REQUEST" --state-dir "$ARCHIVE" --json
node dist/cli/main.js environment operation "$PLAN_REQUEST" --state-dir "$ARCHIVE" --json
node dist/cli/main.js environment show "$WORKSPACE" --state-dir "$ARCHIVE" --json
```

Usare un UUID nuovo per `PLAN_REQUEST`. Se il piano è MANUAL_REQUIRED, registrare le limitazioni osservate dopo il setup manuale con **Prepara attestazione manuale**. L’esito è MANUAL_VERIFIED. In headless il corpo di autorizzazione è JSON da file o stdin e contiene `action: "attest"`, `intent` con `workspaceId`, `inputDigest` e `limitations`, ed `expectedRevisions.stateRevision`.

## Installazione isolata

Usare un manifest con una dipendenza pnpm e un lockfile coerente nella fixture. I test offrono due lockfile distinti tramite registry loopback e verificano l’indipendenza delle copie. Confermare **Prepara installazione** per un piano PLANNED. In CLI inviare `action: "prepare"`, `intent` con `planId` e `planDigest`, ed `expectedRevisions.stateRevision` a `environment prepare --input-file FILE`. Consumare il grant con `environment prepare --grant UUID --request-id UUID`. La risposta indica `jobId`. L’operazione originale resta interrogabile dopo la chiusura del client.

## Controllo registrato e recovery

Aggiungere al manifest pnpm una definizione di esempio e includere `check.mjs` nella radice del worktree prima di pianificare.

```json
{
  "maestro": {
    "validation": [
      {
        "id": "fe17efd7-ecae-470f-9444-7a49ed67b617",
        "entry": "check.mjs",
        "argv": ["fixture ; |"],
        "timeoutMs": 5000
      }
    ]
  }
}
```

```js
process.exit(process.argv[2] === 'fixture ; |' ? 0 : 2);
```

Dopo l’installazione, scegliere **Prepara controllo check.mjs** e confermare. In CLI preparare `action: "validate"`, `intent` con `environmentId`, `commandSpecId` e `inputDigest`, ed `expectedRevisions.stateRevision`. Usare il grant con `environment validate --grant UUID --request-id UUID`. Il supervisore esegue una copia sigillata dell’entrypoint con cwd nella radice del worktree, argomenti letterali, rete e scrittura sul worktree bloccate. I risultati contengono diagnostica strutturata con codice di uscita, digest, byte osservati e troncamento. I flussi grezzi del subprocess restano privati.

```sh
node dist/cli/main.js environment job "$JOB" --state-dir "$ARCHIVE" --json
node dist/cli/main.js environment output "$JOB" --state-dir "$ARCHIVE" --json
node dist/cli/main.js environment artifact "$ARTIFACT" --state-dir "$ARCHIVE" --json
node dist/cli/main.js environment reconcile "$JOB" --expected-revision "$JOB_REVISION" \
  --request-id "$OBSERVATION_REQUEST" --state-dir "$ARCHIVE" --json
```

Usare l’UUID del job originale per letture e riconciliazione. Il tentativo di riconciliazione ha un proprio UUID, così un’eventuale risposta persa resta interrogabile. RECONCILING conserva la lease finché manca la prova d’uscita. Un cambio di manifest, lock o entrypoint richiede un nuovo piano. [Contratto API](contracts/api.md) · [Validazione](reports/validation.md) · [Readiness](reports/release-readiness.md)
