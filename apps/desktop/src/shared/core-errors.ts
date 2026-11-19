// Public core v1 safe error catalog; no runtime dependency on core adapters.
export const CORE_ERRORS = {
  "WORKSPACE_LIMIT": {
    "code": "WORKSPACE_LIMIT",
    "message": "Limite di workspace raggiunto.",
    "nextAction": "Consultare i workspace già conservati."
  },
  "WORKSPACE_NOT_FOUND": {
    "code": "WORKSPACE_NOT_FOUND",
    "message": "Workspace non trovato.",
    "nextAction": "Rileggere i workspace nell’archivio corrente."
  },
  "WORKSPACE_IN_USE": {
    "code": "WORKSPACE_IN_USE",
    "message": "Workspace o repository riservato.",
    "nextAction": "Interrogare il lavoro attivo e il relativo esito."
  },
  "WORKSPACE_UNSAFE": {
    "code": "WORKSPACE_UNSAFE",
    "message": "Confine Git o configurazione non qualificati.",
    "nextAction": "Verificare il pin, gli anchor e la configurazione locale."
  },
  "BASE_CHANGED": {
    "code": "BASE_CHANGED",
    "message": "La base Git è cambiata.",
    "nextAction": "Rileggere la base e preparare un nuovo consenso."
  },
  "BRANCH_EXISTS": {
    "code": "BRANCH_EXISTS",
    "message": "Il branch riservato esiste già.",
    "nextAction": "Verificare l’operazione originale e la proprietà."
  },
  "OWNERSHIP_UNPROVEN": {
    "code": "OWNERSHIP_UNPROVEN",
    "message": "Proprietà del workspace non provata.",
    "nextAction": "Interrogare lo stato della risorsa prima di proseguire."
  },
  "UNINTEGRATED_WORK": {
    "code": "UNINTEGRATED_WORK",
    "message": "Lavoro locale o integrazione non dimostrata.",
    "nextAction": "Verificare i file e la destinazione Git."
  },
  "GIT_CONFLICT": {
    "code": "GIT_CONFLICT",
    "message": "Operazione Git in conflitto.",
    "nextAction": "Ispezionare il workspace e conservare il lavoro."
  },
  "WORKSPACE_NOT_INITIALIZED": {
    "code": "WORKSPACE_NOT_INITIALIZED",
    "message": "Archivio workspace non inizializzato.",
    "nextAction": "Avviare esplicitamente il servizio per aggiornare l’archivio."
  },
  "INVALID_REQUEST": {
    "code": "INVALID_REQUEST",
    "message": "Richiesta non valida.",
    "nextAction": "Controllare argomenti e aiuto locale."
  },
  "INVALID_NAME": {
    "code": "INVALID_NAME",
    "message": "Nome progetto non valido.",
    "nextAction": "Usare da 1 a 120 caratteri Unicode senza controlli."
  },
  "INVALID_BASE_BRANCH": {
    "code": "INVALID_BASE_BRANCH",
    "message": "Branch base locale non valido.",
    "nextAction": "Selezionare esplicitamente un branch locale con un commit."
  },
  "PATH_ACCESS_DENIED": {
    "code": "PATH_ACCESS_DENIED",
    "message": "Percorso locale non accessibile.",
    "nextAction": "Ripristinare esplicitamente i permessi di accesso."
  },
  "REVISION_CONFLICT": {
    "code": "REVISION_CONFLICT",
    "message": "Revisione configurazione non più corrente.",
    "nextAction": "Rileggere il progetto prima di una nuova richiesta."
  },
  "OBSERVATION_SUPERSEDED": {
    "code": "OBSERVATION_SUPERSEDED",
    "message": "Osservazione superata da una modifica concorrente.",
    "nextAction": "Rileggere il progetto e richiedere una nuova verifica."
  },
  "REGISTRY_CHANGED": {
    "code": "REGISTRY_CHANGED",
    "message": "Registro cambiato durante la lettura paginata.",
    "nextAction": "restart-list"
  },
  "REPOSITORY_NOT_FOUND": {
    "code": "REPOSITORY_NOT_FOUND",
    "message": "Repository locale non trovato.",
    "nextAction": "Rendere disponibile il percorso senza ricrearlo automaticamente."
  },
  "REFERENCE_CHECKOUT_UNAVAILABLE": {
    "code": "REFERENCE_CHECKOUT_UNAVAILABLE",
    "message": "Checkout di riferimento non disponibile.",
    "nextAction": "Ripristinare il riferimento originale senza sostituirlo."
  },
  "REPOSITORY_UNSUPPORTED": {
    "code": "REPOSITORY_UNSUPPORTED",
    "message": "Formato repository non supportato.",
    "nextAction": "Usare un checkout e un formato supportati."
  },
  "GIT_UNAVAILABLE": {
    "code": "GIT_UNAVAILABLE",
    "message": "Git qualificato non disponibile.",
    "nextAction": "Installare una versione Git supportata."
  },
  "REPOSITORY_CHANGED": {
    "code": "REPOSITORY_CHANGED",
    "message": "Identità del repository cambiata o incerta.",
    "nextAction": "Rivedere il riferimento senza un rebind automatico."
  },
  "REPOSITORY_UNSTABLE": {
    "code": "REPOSITORY_UNSTABLE",
    "message": "Repository cambiato durante la verifica.",
    "nextAction": "Richiedere una nuova verifica quando il repository è stabile."
  },
  "INSPECTION_UNAVAILABLE": {
    "code": "INSPECTION_UNAVAILABLE",
    "message": "Ispezione confinata non disponibile.",
    "nextAction": "Verificare piattaforma e profilo di confinamento."
  },
  "INSPECTION_UNSAFE": {
    "code": "INSPECTION_UNSAFE",
    "message": "Ispezione non sicura con la configurazione corrente.",
    "nextAction": "Rivedere la configurazione senza eseguire helper o fallback."
  },
  "UNKNOWN_OUTCOME": {
    "code": "UNKNOWN_OUTCOME",
    "message": "Esito della richiesta non ancora verificato.",
    "nextAction": "Interrogare lo stesso requestId prima di un nuovo intento."
  },
  "INTERRUPTED": {
    "code": "INTERRUPTED",
    "message": "Operazione interrotta senza riesecuzione automatica.",
    "nextAction": "read-project-then-new-request"
  },
  "OUTPUT_LIMIT": {
    "code": "OUTPUT_LIMIT",
    "message": "Output di ispezione oltre il limite consentito.",
    "nextAction": "Ridurre il carico o attendere supporto senza assumere uno stato pulito."
  },
  "PROJECT_NOT_FOUND": {
    "code": "PROJECT_NOT_FOUND",
    "message": "Progetto non registrato.",
    "nextAction": "Verificare il projectId nel registro corrente."
  },
  "OPERATION_NOT_FOUND": {
    "code": "OPERATION_NOT_FOUND",
    "message": "Intento non presente nel registro delle operazioni.",
    "nextAction": "Verificare archivio e requestId prima di un nuovo comando."
  },
  "PROJECT_REMOVED": {
    "code": "PROJECT_REMOVED",
    "message": "Registrazione del progetto rimossa.",
    "nextAction": "Rileggere il registro senza riusare il vecchio projectId."
  },
  "DAEMON_UNAVAILABLE": {
    "code": "DAEMON_UNAVAILABLE",
    "message": "Daemon non disponibile per la mutazione.",
    "nextAction": "Avviare esplicitamente il daemon e interrogare il requestId."
  },
  "UNSUPPORTED_VERSION": {
    "code": "UNSUPPORTED_VERSION",
    "message": "Versione del protocollo non supportata.",
    "nextAction": "Usare un client compatibile."
  },
  "UNSUPPORTED_PLATFORM": {
    "code": "UNSUPPORTED_PLATFORM",
    "message": "Piattaforma non supportata.",
    "nextAction": "Usare macOS 26.3 arm64 su APFS locale."
  },
  "UNAUTHORIZED": {
    "code": "UNAUTHORIZED",
    "message": "Operazione non autorizzata.",
    "nextAction": "Verificare proprietario e credenziali locali."
  },
  "STALE_TARGET": {
    "code": "STALE_TARGET",
    "message": "Istanza di destinazione non più corrente.",
    "nextAction": "Rileggere lo stato prima di una nuova richiesta."
  },
  "IDEMPOTENCY_CONFLICT": {
    "code": "IDEMPOTENCY_CONFLICT",
    "message": "Identificativo già usato per un intento diverso.",
    "nextAction": "Usare lo stesso payload o un nuovo requestId."
  },
  "INVALID_TRANSITION": {
    "code": "INVALID_TRANSITION",
    "message": "Transizione non consentita per lo stato corrente.",
    "nextAction": "Rileggere lo stato e conservare gli esiti già conclusi."
  },
  "BUSY": {
    "code": "BUSY",
    "message": "Operazione già in corso.",
    "nextAction": "Interrogare la richiesta attiva o riprovare."
  },
  "BLOCKED": {
    "code": "BLOCKED",
    "message": "Operazione bloccata per sicurezza.",
    "nextAction": "Verificare risorse e diagnostica prima del retry."
  },
  "EVENT_BACKPRESSURE": {
    "code": "EVENT_BACKPRESSURE",
    "message": "Osservabilità bloccata: il batch precedente non è drenato.",
    "nextAction": "Consultare diagnostics e preservare il journal prima di riprovare."
  },
  "PERSISTENCE_UNAVAILABLE": {
    "code": "PERSISTENCE_UNAVAILABLE",
    "message": "Stato persistente non disponibile.",
    "nextAction": "Verificare spazio, permessi e disponibilità del disco."
  },
  "STATE_INCOMPATIBLE": {
    "code": "STATE_INCOMPATIBLE",
    "message": "Versione dello stato non compatibile.",
    "nextAction": "Usare una versione compatibile senza ricreare lo stato."
  },
  "STATE_ABSENT": {
    "code": "STATE_ABSENT",
    "message": "Archivio locale assente.",
    "nextAction": "Avviare esplicitamente il daemon per inizializzare lo stato."
  },
  "REGISTRY_NOT_INITIALIZED": {
    "code": "REGISTRY_NOT_INITIALIZED",
    "message": "Registro progetti non inizializzato.",
    "nextAction": "Eseguire daemon start esplicito per aggiornare lo schema."
  },
  "STATE_CORRUPT": {
    "code": "STATE_CORRUPT",
    "message": "Integrità dello stato non verificabile.",
    "nextAction": "Preservare i file e richiedere un intervento manuale."
  },
  "DEADLINE_EXCEEDED": {
    "code": "DEADLINE_EXCEEDED",
    "message": "Attesa conclusa senza esito verificato.",
    "nextAction": "Interrogare il requestId; non ripetere effetti alla cieca."
  },
  "RESOURCE_IDENTITY_UNKNOWN": {
    "code": "RESOURCE_IDENTITY_UNKNOWN",
    "message": "Proprietà di una risorsa non verificata.",
    "nextAction": "Verificare la risorsa senza terminare processi da un PID salvato."
  },
  "ENDPOINT_COLLISION": {
    "code": "ENDPOINT_COLLISION",
    "message": "Endpoint locale già occupato o incerto.",
    "nextAction": "Verificare proprietario e stato senza eliminare artefatti estranei."
  },
  "CURSOR_EXPIRED": {
    "code": "CURSOR_EXPIRED",
    "message": "Parte degli eventi non è più conservata.",
    "nextAction": "Rileggere lo stato e scegliere da dove riprendere."
  },
  "WRONG_STORE": {
    "code": "WRONG_STORE",
    "message": "Cursore riferito a un altro archivio.",
    "nextAction": "Usare il cursore dell’archivio corrente."
  },
  "SLOW_CONSUMER": {
    "code": "SLOW_CONSUMER",
    "message": "Osservatore scollegato per limite del buffer.",
    "nextAction": "Riprendere con il cursore dell’ultimo evento ricevuto."
  },
  "DAEMON_ABSENT": {
    "code": "DAEMON_ABSENT",
    "message": "Il processo del daemon risulta cessato.",
    "nextAction": "Eseguire un controllo esplicito per riconciliare lo stato salvato."
  },
  "SERVICE_UNREACHABLE": {
    "code": "SERVICE_UNREACHABLE",
    "message": "Servizio locale non raggiungibile.",
    "nextAction": "Interrogare status e conservare l’ultima sequenza ricevuta."
  },
  "CONTROL_INTERRUPTED": {
    "code": "CONTROL_INTERRUPTED",
    "message": "Controller terminato senza esito verificato.",
    "nextAction": "Interrogare e riprovare lo stesso requestId per riconciliare l’esito."
  },
  "CORE_EXITED_BEFORE_ACCEPTANCE": {
    "code": "CORE_EXITED_BEFORE_ACCEPTANCE",
    "message": "Core terminato prima della conferma di accettazione.",
    "nextAction": "Verificare runtime e interrogare il requestId."
  },
  "INTERNAL_ERROR": {
    "code": "INTERNAL_ERROR",
    "message": "Errore interno non classificato.",
    "nextAction": "Consultare la diagnostica redatta e preservare lo stato."
  },
  "APPROVAL_REQUIRED": {
    "code": "APPROVAL_REQUIRED",
    "message": "Approvazione esplicita richiesta.",
    "nextAction": "Preparare e confermare lo scope corrente prima di inviare."
  },
  "APPROVAL_STALE": {
    "code": "APPROVAL_STALE",
    "message": "Approvazione non più valida per questo intento.",
    "nextAction": "Rileggere revisioni e contesto, poi confermare un nuovo intento."
  },
  "ANSWER_CONFLICT": {
    "code": "ANSWER_CONFLICT",
    "message": "Risposta o revisione domanda non più corrente.",
    "nextAction": "Rileggere la domanda e conservare la risposta già registrata."
  },
  "CHECK_EXPIRED": {
    "code": "CHECK_EXPIRED",
    "message": "Controllo di idoneità scaduto o non disponibile.",
    "nextAction": "Richiedere intenzionalmente un nuovo controllo locale."
  },
  "ARTIFACT_CORRUPT": {
    "code": "ARTIFACT_CORRUPT",
    "message": "Integrità dell’artefatto non verificabile.",
    "nextAction": "Preservare i file e verificare lo stato senza riparazioni automatiche."
  },
  "CONTEXT_CHANGED": {
    "code": "CONTEXT_CHANGED",
    "message": "Il contesto autorizzato è cambiato.",
    "nextAction": "Creare una nuova anteprima e confermare il nuovo scope."
  },
  "CONTEXT_UNSTABLE": {
    "code": "CONTEXT_UNSTABLE",
    "message": "Il contesto è cambiato durante la raccolta.",
    "nextAction": "Ripetere la preparazione quando i file sono stabili."
  },
  "CONTEXT_LIMIT": {
    "code": "CONTEXT_LIMIT",
    "message": "Il contesto supera i limiti di raccolta o trasporto.",
    "nextAction": "Ridurre lo scope senza assumere una raccolta completa."
  },
  "SOURCE_EXCLUDED": {
    "code": "SOURCE_EXCLUDED",
    "message": "La selezione contiene una fonte esclusa.",
    "nextAction": "Selezionare file consentiti senza ampliare i permessi."
  },
  "DISCOVERY_BUSY": {
    "code": "DISCOVERY_BUSY",
    "message": "Una Discovery occupa già lo slot locale.",
    "nextAction": "Interrogare la Discovery corrente prima di un nuovo avvio."
  },
  "DISCOVERY_LIMIT": {
    "code": "DISCOVERY_LIMIT",
    "message": "Limite locale Discovery raggiunto.",
    "nextAction": "Consultare quota e stato; nessun risultato viene eliminato automaticamente."
  },
  "PROVIDER_NOT_CONFIGURED": {
    "code": "PROVIDER_NOT_CONFIGURED",
    "message": "Provider non configurato.",
    "nextAction": "Configurare esplicitamente il provider supportato."
  },
  "PROVIDER_AUTH_REQUIRED": {
    "code": "PROVIDER_AUTH_REQUIRED",
    "message": "Login ufficiale del provider richiesto.",
    "nextAction": "Eseguire il login ufficiale nel profilo dedicato e verificarlo."
  },
  "PROVIDER_UNSUPPORTED": {
    "code": "PROVIDER_UNSUPPORTED",
    "message": "Capacità o versione provider non supportata.",
    "nextAction": "Usare un binario e un profilo qualificati."
  },
  "PROVIDER_UNSAFE": {
    "code": "PROVIDER_UNSAFE",
    "message": "Confinamento o configurazione provider non qualificati.",
    "nextAction": "Verificare binario, profilo, Keychain e policy gestite senza allentare i permessi."
  },
  "PROVIDER_UNAVAILABLE": {
    "code": "PROVIDER_UNAVAILABLE",
    "message": "Provider non disponibile.",
    "nextAction": "Verificare il provider prima di un nuovo intento esplicito."
  },
  "PROVIDER_QUOTA": {
    "code": "PROVIDER_QUOTA",
    "message": "Quota del provider non disponibile per questa esecuzione.",
    "nextAction": "Verificare lo stato del proprio account senza retry automatici."
  },
  "PROVIDER_PROTOCOL_ERROR": {
    "code": "PROVIDER_PROTOCOL_ERROR",
    "message": "Risposta provider non conforme.",
    "nextAction": "Consultare il codice safe e conservare l’output parziale."
  },
  "PROVIDER_OUTPUT_LIMIT": {
    "code": "PROVIDER_OUTPUT_LIMIT",
    "message": "Output provider oltre il limite.",
    "nextAction": "Conservare l’output parziale e rivedere lo scope prima di un nuovo intento."
  },
  "PROVIDER_CONTEXT_LIMIT": {
    "code": "PROVIDER_CONTEXT_LIMIT",
    "message": "Input oltre la capacità del profilo provider.",
    "nextAction": "Ridurre lo scope o configurare un modello qualificato con capacità adeguata."
  },
  "DISCOVERY_NOT_INITIALIZED": {
    "code": "DISCOVERY_NOT_INITIALIZED",
    "message": "Discovery non inizializzata.",
    "nextAction": "Eseguire daemon start esplicito per aggiornare lo schema."
  },
  "FEATURE_NOT_INITIALIZED": {
    "code": "FEATURE_NOT_INITIALIZED",
    "message": "Pianificazione feature non inizializzata.",
    "nextAction": "Eseguire daemon start esplicito per aggiornare lo schema."
  },
  "FEATURE_NOT_FOUND": {
    "code": "FEATURE_NOT_FOUND",
    "message": "Feature non presente.",
    "nextAction": "Verificare archivio e identificativo."
  },
  "FEATURE_IN_USE": {
    "code": "FEATURE_IN_USE",
    "message": "Feature utilizzata da lavoro attivo.",
    "nextAction": "Consultare e riconciliare lo stato prima di archiviare."
  },
  "FEATURE_LIMIT": {
    "code": "FEATURE_LIMIT",
    "message": "Limite locale delle feature raggiunto.",
    "nextAction": "Consultare quota e revisioni; nessuna cancellazione automatica."
  },
  "DISCOVERY_REQUIRED": {
    "code": "DISCOVERY_REQUIRED",
    "message": "Discovery approvata e corrente richiesta.",
    "nextAction": "Completare e approvare la Discovery del progetto."
  },
  "PLANNING_UNAVAILABLE": {
    "code": "PLANNING_UNAVAILABLE",
    "message": "Generazione assistita non qualificata.",
    "nextAction": "Usare authoring manuale con Discovery corrente o verificare il provider."
  },
  "RESOURCE_LIMIT": {
    "code": "RESOURCE_LIMIT",
    "message": "Quota locale raggiunta.",
    "nextAction": "Consultare risorse e limiti senza eliminare lavoro referenziato."
  }
} as const;
