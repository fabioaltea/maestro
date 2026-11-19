# Policy — Profiles, Skills & Tools

## Risoluzione deterministica

Ordine: policy core → progetto → revisione profilo → dipendenze skill/tool. Scope non è fiducia implicita. Gli alias globali/progetto richiedono selezione esplicita della revisione locale quando collidono; mai sostituzione silenziosa. Skill mandatory sono unione degli ID richiesti, recommended facoltative con omissioni visibili. Cicli o versioni incompatibili falliscono con conflitto.

Permessi: allowEffective = intersection(coreAllowed,projectGrant,profileAllowed,runtimeCapability); denyEffective = union(tutti i deny). Requisiti skill/tool devono essere subset dei permessi effettivi e disgiunti dai deny; il resolver non aggiunge un allow solo perché una skill lo richiede. Path grant contengono workspace IDs/anchor, non globs root di filesystem; rete contiene destinatari tipizzati e azioni. Capability unknown equivale false.

Risoluzione include versioni/digest ordinati di profilo, skill, tool, policy, progetto, capability e schema istruzioni. Hash degli stessi byte canonici produce lo stesso digest; riferimenti a contenuti sigillati, mai filesystem latest. Nuova revisione non muta un run corrente; revoca di permesso critico impedisce nuove tool admission e richiede stop/checkpoint al primo confine sicuro per il run attivo. Non promettere rollback di effetti già autorizzati/eseguiti.

## Import e tool

ImportHandle proviene da native picker main o CLI fidata; preview reader readonly no-follow valida origine/root/file membership e limiti prima di seal. Bundle locale contiene manifest dei file e hash, SKILL.md testo e allegati consentiti, nessun symlink/executable auto-run. Source changed prima del consumo del grant invalida preview. Provenienza dichiarata non equivale a firma o fiducia verificata: mostrare UNKNOWN/USER_REVIEWED.

ToolManifest v1: toolId/name, version, kind LOCAL_COMMAND/MCP, executableRef/provider endpoint tipizzato, argvSchema, input/output limits, requiredPermissions, credentialRequirements (nomi, non valori), sourceDigest. Local command è CommandSpec; MCP abilitato solo se009 ha protocol bridge e capability qualificata. Import/ENABLED registra dati, non avvia processi o connessioni. MCP non supportato resta UNSUPPORTED, non comunicazione diretta renderer→server.

Suggerimenti sono regole locali deterministiche basate sui requisiti mancanti e catalogo già importato, massimo20; non scansione cloud o raccomandazione che avvia download. Install/config a runtime è un flusso preview→grant→import/enable di bundle locale mentre il daemon è attivo;009 deve rivalidare e richiedere nuovo envelope prima di usarlo. Download da URL/marketplace è fuori scope.

## Ruoli iniziali

Project Architect resta readonly e policy-bound004/005. Frontend e Backend chiedono capability execution write nei soli workspace; QA usa CommandSpec di validazione; Reviewer legge snapshot e prove; Release Manager produce piano/testo. Nessun ruolo pubblica o integra dal solo nome:011/012 applicano grant propri. I seed non attivano provider, skill obbligatorie inesistenti o tool sconosciuti per default.
