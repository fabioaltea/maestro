# Data Model — Agent Profiles, Skills & Tools

**Schema proposto**: 8 cumulativo dopo7; nessuna tabella implementata da questa pianificazione. Identità UUID, revisioni decimali stringa, timestamp UTC e digest SHA256 come nella base.

## Entità e relazioni

| Entità | Campi, relazioni e validazione |
|---|---|
| AgentProfileRevision | profileId,revisionId,scope GLOBAL/PROJECT,projectId?,role,instructionsArtifactId,preferredProviders,requiredSkillRefs,recommendedSkillRefs,toolRefs,permissions,validationRefs,digest,disabledAt |
| SkillRevision | skillId,revisionId,scope,sourceRef,provenance,contentArtifactId,sha256,declaredRequirements,status; SKILL.md non è codice da eseguire |
| ToolRevision | toolId,revisionId,kind LOCAL_COMMAND/MCP,manifestDigest,executableRef,argvSchema,networkScope,permissionRequirements,status; credentialRef opaco separato |
| ResolvedProfile | resolutionId,profileRevisionId,projectConfigRevision,corePolicyRevision,skillRevisionIds,toolRevisionIds,providerCapabilityDigest,effectivePermissions,digest |
| ExtensionApproval | approvalId,action IMPORT/ENABLE_TOOL,sourceDigest,manifestDigest,scope,ownerUid,approvedAt; revocabile con nuova revisione |

Tutte le righe hanno storeId e riferimenti projectId/featureId applicabili; FK impediscono riferimenti ad altri store o revisioni di altra entità. Configurazioni e approvazioni sono append-only; disabilitazione/tombstone non cancella dati referenziati. Per le associazioni esterne usare ID opachi e digest, mai token o path del client come autorità.

## Tabelle e commit

Persistenza in `src/storage/profiles-schema.ts` e `profiles-store.ts`, tabelle prefissate `profiles_`. Mappare una tabella per le entità sopra e tabelle join per riferimenti multivalore; indici unici su ID, (parentId,revision) e chiavi di idempotenza. Una revisione non cambia contenuto dopo seal. Update di stato usa CAS expectedStateRevision, incrementa revisione ed emette outbox nella stessa transazione.

Non creare un secondo ledger: `workflow_operations`/grant/artefatti comuni sono introdotti005. Le operazioni di questo modulo usano il namespace canonico specificato nel contratto API, requestId e hash dell’intent. UUID globali devono essere esclusivi anche nei ledger preesistenti. Riferimenti a oggetti solo dopo seal/fsync/hash; reservation conteggiata finché reconcile o discard sicuro dimostrano la liberazione.

## State Transitions

Profile/Skill/Tool DRAFT → REVIEWED → ENABLED → DISABLED; nuove revisioni non mutano le vecchie. ResolvedProfile CURRENT → STALE se input/capability/policy cambia. Tool importato non è automaticamente ENABLED o avviato.

Stato operazione e stato dell’entità sono distinti: admission riuscita non implica workflow concluso. Un processo/evento di generation superata non modifica l’entità corrente. Esito remoto o uscita processo non provati restano UNKNOWN/RECONCILING con debit/lease, non terminali di successo.

## Invarianti e autorizzazioni

- Revisioni/config/digest nell’intent devono coincidere con snapshot approvato e stato corrente prima dell’effetto. La verifica filesystem richiede observation e controllo finale, non una transazione globale immaginaria.
- Import/riferimenti progetto in sola lettura; nessuna scrittura di AGENTS.md/CLAUDE.md/config provider nel checkout o Git mutations.
- Provider preferences e fallback sono desideri, non capability; resolver interseca permessi core, progetto, profilo, skill/tool e adapter qualificato. Nessuna autenticazione provider durante lettura.
- Relazioni con entità storiche conservate; rimozione solo senza riferimenti e senza lavoro/processi/effetti incerti.
- ≤100profili,200skill,50tool abilitati; SKILL.md≤64KiB, bundle≤256KiB; max20skill/10tool per risoluzione e input complessivo≤512KiB; quota workflow comune.
- Quota e riserva terminale come [contratti trasversali](../../docs/missing-features-contracts.md); query/cancel/recovery disponibili a saturazione, niente eviction automatica di dati irrisolti.

## Recovery e schema

Testare fault prima/dopo commit di upgrade e ogni pubblicazione artefatto/effetto delle storie. Reader storico immutabile; offline freshness LAST_KNOWN e eligibility=false/UNKNOWN. Riconciliare identità archive, FK, riferimenti/hash e prove esterne prima di rilasciare risorse. Se prova assente o ambigua, preservare i dati e rendere il blocco interrogabile con requestId originale.
