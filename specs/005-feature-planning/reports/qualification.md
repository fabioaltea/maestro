# Qualification005

Date2026-11-19. G0 synthetic PASS, official G1 BLOCKED by004/T028/T050. Runtime availability remains false until official authentication and the composed capability qualify.

## T004 — real pinned CLI, synthetic backend only

`MAESTRO_FEATURE_G0=1 MAESTRO_DISCOVERY_G0=1 node --test --test-concurrency=1 dist-tests/tests/integration/feature-boundary.test.js dist-tests/tests/integration/discovery-provider-boundary.test.js`:12PASS,0FAIL,0SKIP in2197ms. Includes unchanged shipped readonly OS profile, denied protected reads/writes/symlink/exec and injected tools, hostile config, real pin hash, closed argv/env, plus feature DRAFT through the real CLI and localhost synthetic Responses backend. Project/fixture snapshot unchanged. Fixture-only fake auth is not exposed in production.

The new result schema/parser is a data boundary, not authority; source/answer provenance is checked and approvals/commands rejected. Model validity and semantic quality are not established by synthetic completion. The test schema intentionally accepts a bundle object which the core parser then validates strictly; this does not relax runtime permissions.

Pin/version/policy: exactly the existing004 constants in src/providers/codex/argv.ts and shipped provider.sb; no binary, package, login/profile or production authentication change. Pin checked by SHA256 in each real-cli test. Official Keychain precheck004 was PROVIDER_UNSAFE before inference; no inference to official backend, token extraction, API key or fallback attempted.

Authoring/data gate can proceed. Assisted generation must remain unavailable in production unless its separate runtime/auth checks pass. Test substitutes do not create approved production Discovery.

## T035 — quickstart e cap

Verifica del 19 novembre 2026 su fixture locali macOS arm64 con Node 26.13.0. Il comando seguente ha dato **19 PASS, 0 FAIL, 0 SKIP** in 57,8 s.

```sh
node --test --test-concurrency=1 dist-tests/tests/integration/{feature-us1,feature-us2,feature-us3,feature-offline,feature-context-budget,workflow-store}.test.js
```

| Scenario | Esito osservato |
|---|---|
| US1 e SC-001 | 10 feature distinte nello stesso progetto fixture con Discovery corrente. Ciascuna è stata creata, letta e corretta. Entrambe le revisioni e i rispettivi contenuti sono recuperabili. Snapshot del repository invariato. |
| US2 e SC-002 | L’approvazione e l’handoff usano la revisione esatta. Cambiare contesto o produrre una revisione concorrente blocca l’azione. La decisione già emessa resta leggibile. |
| US3 | Due turni confermati producono una domanda e una bozza con risposta e provenance. Una variazione del modello rende il consenso obsoleto. Timeout, risultato tardivo e uscita incerta mantengono l’esito interrogabile. |
| SC-003 | 10 replay dello stesso UUID con esito identico, una feature e nessun aggiornamento aggiuntivo della revisione dell’archivio. |
| SC-004 | Il reader confinato e il percorso Electron di T034 recuperano la revisione e l’approvazione salvate dopo l’arresto e la riapertura. |

I contratti e le implementazioni verificati applicano richiesta 16 KiB, bundle e risultato 256 KiB, 50 criteri, 50 revisioni, 20 turni e 20 domande, risposta 4 KiB, envelope 32 KiB e chunk 8 KiB. La deadline di generazione di 10 minuti è verificata con clock controllato e quella di contesto con I/O fixture. La suite di quota simula saturazione nel writer e verifica query e riserva di cancellazione. I tempi riportati sono durate delle suite in questo ambiente.

Ripetizione G0 sul binario 0.167.0 con hash fissato e backend locale sintetico. **12 PASS, 0 FAIL, 0 SKIP** in 2,1 s, inclusi decoder, negazioni del profilo readonly e assenza di mutazioni del checkout.

```sh
MAESTRO_FEATURE_G0=1 MAESTRO_DISCOVERY_G0=1 node --test --test-concurrency=1 dist-tests/tests/integration/{feature-boundary,discovery-provider-boundary}.test.js
```

| Gate | Esito |
|---|---|
| Flussi automatici con fixture | PASS per US1, US2, US3 |
| G0 sintetico con CLI fissata | PASS |
| G1 ufficiale e inferenza reale 005 | BLOCKED da 004/T028 e 004/T050. Il precheck 004 ha restituito `PROVIDER_UNSAFE` prima dell’inferenza. |
| Generazione nel daemon di produzione | Indisponibile. `feature.provider.get` restituisce `qualified: false`. |
| Review umana e picker reale | NOT_RUN |
