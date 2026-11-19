# Contract — Agent Profiles, Skills & Tools v1

**Stato**: proposto per schema8. Non pubblicare capability finché implementazione e composizione non esistono. Eredita integralmente [contratti trasversali](../../../docs/missing-features-contracts.md) e i confini del trasporto001/002 e client003.

## Envelope, grant e letture

Namespace locale `profile.*`, capability `profileVersion:1`; namespace canonico ledger `PROFILE`. `prepare {action,intent,expectedRevisions}` è comune; risponde grantId,canonicalIntentHash,summary,expiresAt. Le mutazioni consumano grant su intent conservato dal core con requestId UUID e revisioni; gli input indicati nella tabella sono il contenuto canonico da preparare e verificare, non campi facoltativi.

CLI `maestro profile ... --state-dir ABS --json`; mutazioni con `--request-id UUID` e `--grant UUID` quando indicato. Input testuale tramite file/stdin bounded o artifactId sigillato; mai comandi shell, token o path privati forniti dal renderer. Metodi interni marcati internal non sono pubblicati via IPC/CLI. Nessun metodo di lettura può compiere inferenza, login, migrazione o cleanup.

`list/get`, `operation.get {requestId}`, `artifact.get {artifactId,cursor?}` e `output.list` dove applicabile: pagine metadata≤20 ed envelope≤32KiB, chunk8KiB raw con hash/base64, cursori store/target/revision-bound. `get` restituisce entityId,state,stateRevision,configRevision quando applicabile,freshness,checkedAt,safeError; riferimento a artefatto privato non espone path. LIST offline LAST_KNOWN; controlli attuali richiedono daemon e operazione esplicita.

## Metodi e risultati

Ogni metodo è sotto `profile.`; sottosezioni mantengono associazione esplicita alla storia. `requestId` è obbligatorio per ogni mutazione, incluso refresh/configure/reconcile. Dove non è indicato grant: lettura pura o osservazione locale/remote esplicitamente richiesta senza ulteriore effetto; start/install/merge/push/deploy restano sempre soggetti a grant/policy core. Progetti/entità bersaglio rimossi o store differente sono rifiutati.

### US1 — Definire e scegliere profili versionati

| Metodo / CLI equivalente | Intent canonico / input | Risultato dopo admission o lettura |
|---|---|---|
| `create` | scope,projectId?,bundleArtifactId,grantId | profileId,revisionId |
| `revise` | profileId,expectedStateRevision,bundleArtifactId,grantId | revisionId |
| `resolve` | profileId,revisionId,projectId,providerCapabilityDigest | resolutionId,digest,effectivePermissions |

### US2 — Importare e associare skill con provenienza

| Metodo / CLI equivalente | Intent canonico / input | Risultato dopo admission o lettura |
|---|---|---|
| `skill.preview` | importHandle,scope,projectId?,requestId | sourceDigest,manifest,coverage |
| `skill.import` | previewId,sourceDigest,grantId | skillId,revisionId |
| `skill.bind` | profileId,revisionId,requiredRefs,recommendedRefs,grantId | newProfileRevisionId |

### US3 — Configurare tool e permessi senza escalation

| Metodo / CLI equivalente | Intent canonico / input | Risultato dopo admission o lettura |
|---|---|---|
| `tool.import` | manifestArtifactId,sourceDigest,grantId | toolId,revisionId |
| `tool.enable` | toolId,revisionId,permissions,grantId | enabledRevision |
| `disable` | targetId,expectedStateRevision,grantId | disabledRevision |
| `suggest` | profileId,projectId | bounded compatible suggestions |

Regole specifiche di transizione, approvazione e recovery: [policy.md](policy.md).

## Validazione, completion ed errori

UUID validati, DTO chiusi, revisioni decimali positive, digest e enum allowlist; unknown field/command/flag rifiutato. Il risultato mutativo è `{accepted,requestId,entityId?,operationId?,stateRevision}` entro target2s. `operation.get` espone `{action,phase,outcome,acceptedAt,completedAt?,resultIds,safeError}`; stato operazione e lifecycle distinguibili. Stesso requestId/hash recupera il risultato originale; conflitto di intento/namespace → IDEMPOTENCY_CONFLICT. NOT_FOUND dopo un esito incerto non è autorizzazione a ripetere.

Lavoro lungo: admission asincrona, job con deadline e query; output paginato. Timeout non è prova di mancata esecuzione o uscita. Risposta persa → UNKNOWN_OUTCOME con UUID originale. Una nuova operazione può partire solo dopo riconciliazione o nuova autorizzazione pertinente.

Errori specifici: `PROFILE_CONFLICT, REQUIRED_SKILL_MISSING, EXTENSION_UNTRUSTED, PERMISSION_CONFLICT, CAPABILITY_UNAVAILABLE, PROFILE_STALE, TOOL_DISABLED`. Comuni: UNSUPPORTED, FEATURE_NOT_INITIALIZED, INVALID_REQUEST, APPROVAL_REQUIRED, APPROVAL_STALE, IDEMPOTENCY_CONFLICT, RESOURCE_LIMIT, ARTIFACT_CORRUPT. Errori pubblici statici/codici/nextAction, senza raw stderr o segreti. Non rendere un fallimento esterno come successo locale.

## Confini ed effetti

ProfileResolver puro e registry nello stesso writer; artefatti SKILL.md trattati come testo, ToolManifest tipizzato separato dall’eseguibile. Import locale da bundle regolare con hash/provenienza, niente package parser runtime nuovo.

Import/riferimenti progetto in sola lettura; nessuna scrittura di AGENTS.md/CLAUDE.md/config provider nel checkout o Git mutations.

Provider preferences e fallback sono desideri, non capability; resolver interseca permessi core, progetto, profilo, skill/tool e adapter qualificato. Nessuna autenticazione provider durante lettura.

Stati e campi delle prove: [data-model.md](../data-model.md). Dettagli di cap e regole crash/ownership nei contratti trasversali; limiti specifici: ≤100profili,200skill,50tool abilitati; SKILL.md≤64KiB, bundle≤256KiB; max20skill/10tool per risoluzione e input complessivo≤512KiB; quota workflow comune.

## Desktop, eventi e prove

Main `apps/desktop/src/main/profile.ts` chiama CLI e salva ricevuta action/requestId/store/target prima dell’invio; shared DTO in `apps/desktop/src/shared/profile-contract.ts`, preload allowlist e renderer view senza accesso OS. Prepare/confirm mostra azione e ambito correnti; nessuna approvazione ricavata dal prompt. Disabilitare mutazioni offline; history disponibile con data. Epoch di archivio/target e revisioni scartano risultati tardivi.

Eventi `profile.changed`, `profile.output.available` dove applicabile: solo IDs/stato/codice/revisione/watermark; payload testo/diff/documento recuperato via pagina. Estendere core e desktop allowlist nello stesso incremento. Replay/ACK e limiti journal invariati. Test contract API/CLI/bridge e integrazione locale dimostrano validazione, idempotenza cross-namespace, stale grant, output/quote pieni e privacy.
