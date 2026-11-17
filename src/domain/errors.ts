const catalog = {
  APPROVAL_REQUIRED: ["Approvazione esplicita richiesta.", "Preparare e confermare lo scope corrente prima di inviare.", false],
  APPROVAL_STALE: ["Approvazione non più valida per questo intento.", "Rileggere revisioni e contesto, poi confermare un nuovo intento.", false],
  ANSWER_CONFLICT: ["Risposta o revisione domanda non più corrente.", "Rileggere la domanda e conservare la risposta già registrata.", false],
  CHECK_EXPIRED: ["Controllo di idoneità scaduto o non disponibile.", "Richiedere intenzionalmente un nuovo controllo locale.", false],
  ARTIFACT_CORRUPT: ["Integrità dell’artefatto non verificabile.", "Preservare i file e verificare lo stato senza riparazioni automatiche.", false],
  CONTEXT_CHANGED: ["Il contesto autorizzato è cambiato.", "Creare una nuova anteprima e confermare il nuovo scope.", false],
  CONTEXT_UNSTABLE: ["Il contesto è cambiato durante la raccolta.", "Ripetere la preparazione quando i file sono stabili.", false],
  CONTEXT_LIMIT: ["Il contesto supera i limiti di raccolta o trasporto.", "Ridurre lo scope senza assumere una raccolta completa.", false],
  SOURCE_EXCLUDED: ["La selezione contiene una fonte esclusa.", "Selezionare file consentiti senza ampliare i permessi.", false],
  DISCOVERY_BUSY: ["Una Discovery occupa già lo slot locale.", "Interrogare la Discovery corrente prima di un nuovo avvio.", false],
  DISCOVERY_LIMIT: ["Limite locale Discovery raggiunto.", "Consultare quota e stato; nessun risultato viene eliminato automaticamente.", false],
  PROVIDER_NOT_CONFIGURED: ["Provider non configurato.", "Configurare esplicitamente il provider supportato.", false],
  PROVIDER_AUTH_REQUIRED: ["Login ufficiale del provider richiesto.", "Eseguire il login ufficiale nel profilo dedicato e verificarlo.", false],
  PROVIDER_UNSUPPORTED: ["Capacità o versione provider non supportata.", "Usare un binario e un profilo qualificati.", false],
  PROVIDER_UNSAFE: ["Confinamento o configurazione provider non qualificati.", "Verificare binario, profilo, Keychain e policy gestite senza allentare i permessi.", false],
  PROVIDER_UNAVAILABLE: ["Provider non disponibile.", "Verificare il provider prima di un nuovo intento esplicito.", false],
  PROVIDER_QUOTA: ["Quota del provider non disponibile per questa esecuzione.", "Verificare lo stato del proprio account senza retry automatici.", false],
  PROVIDER_PROTOCOL_ERROR: ["Risposta provider non conforme.", "Consultare il codice safe e conservare l’output parziale.", false],
  PROVIDER_OUTPUT_LIMIT: ["Output provider oltre il limite.", "Conservare l’output parziale e rivedere lo scope prima di un nuovo intento.", false],
  PROVIDER_CONTEXT_LIMIT: ["Input oltre la capacità del profilo provider.", "Ridurre lo scope o configurare un modello qualificato con capacità adeguata.", false],
  DISCOVERY_NOT_INITIALIZED: ['Discovery non inizializzata.', 'Eseguire daemon start esplicito per aggiornare lo schema.', false],
  INVALID_REQUEST: ['Richiesta non valida.', 'Controllare argomenti e aiuto locale.', false],
  INVALID_NAME: ['Nome progetto non valido.', 'Usare da 1 a 120 caratteri Unicode senza controlli.', false],
  INVALID_BASE_BRANCH: ['Branch base locale non valido.', 'Selezionare esplicitamente un branch locale con un commit.', false],
  PATH_ACCESS_DENIED: ['Percorso locale non accessibile.', 'Ripristinare esplicitamente i permessi di accesso.', false],
  REVISION_CONFLICT: ['Revisione configurazione non più corrente.', 'Rileggere il progetto prima di una nuova richiesta.', false],
  OBSERVATION_SUPERSEDED: ['Osservazione superata da una modifica concorrente.', 'Rileggere il progetto e richiedere una nuova verifica.', false],
  REGISTRY_CHANGED: ['Registro cambiato durante la lettura paginata.', 'restart-list', true],
  REPOSITORY_NOT_FOUND: ['Repository locale non trovato.', 'Rendere disponibile il percorso senza ricrearlo automaticamente.', false],
  REFERENCE_CHECKOUT_UNAVAILABLE: ['Checkout di riferimento non disponibile.', 'Ripristinare il riferimento originale senza sostituirlo.', true],
  REPOSITORY_UNSUPPORTED: ['Formato repository non supportato.', 'Usare un checkout e un formato supportati.', false],
  GIT_UNAVAILABLE: ['Git qualificato non disponibile.', 'Installare una versione Git supportata.', false],
  REPOSITORY_CHANGED: ['Identità del repository cambiata o incerta.', 'Rivedere il riferimento senza un rebind automatico.', false],
  REPOSITORY_UNSTABLE: ['Repository cambiato durante la verifica.', 'Richiedere una nuova verifica quando il repository è stabile.', true],
  INSPECTION_UNAVAILABLE: ['Ispezione confinata non disponibile.', 'Verificare piattaforma e profilo di confinamento.', false],
  INSPECTION_UNSAFE: ['Ispezione non sicura con la configurazione corrente.', 'Rivedere la configurazione senza eseguire helper o fallback.', false],
  UNKNOWN_OUTCOME: ['Esito della richiesta non ancora verificato.', 'Interrogare lo stesso requestId prima di un nuovo intento.', true],
  INTERRUPTED: ['Operazione interrotta senza riesecuzione automatica.', 'read-project-then-new-request', false],
  OUTPUT_LIMIT: ['Output di ispezione oltre il limite consentito.', 'Ridurre il carico o attendere supporto senza assumere uno stato pulito.', false],
  PROJECT_NOT_FOUND: ['Progetto non registrato.', 'Verificare il projectId nel registro corrente.', false],
  OPERATION_NOT_FOUND: ['Intento non presente nel registro delle operazioni.', 'Verificare archivio e requestId prima di un nuovo comando.', false],
  PROJECT_REMOVED: ['Registrazione del progetto rimossa.', 'Rileggere il registro senza riusare il vecchio projectId.', false],
  DAEMON_UNAVAILABLE: ['Daemon non disponibile per la mutazione.', 'Avviare esplicitamente il daemon e interrogare il requestId.', true],
  UNSUPPORTED_VERSION: ['Versione del protocollo non supportata.', 'Usare un client compatibile.', false],
  UNSUPPORTED_PLATFORM: ['Piattaforma non supportata.', 'Usare macOS 26.3 arm64 su APFS locale.', false],
  UNAUTHORIZED: ['Operazione non autorizzata.', 'Verificare proprietario e credenziali locali.', false],
  STALE_TARGET: ['Istanza di destinazione non più corrente.', 'Rileggere lo stato prima di una nuova richiesta.', false],
  IDEMPOTENCY_CONFLICT: ['Identificativo già usato per un intento diverso.', 'Usare lo stesso payload o un nuovo requestId.', false],
  INVALID_TRANSITION: ['Transizione non consentita per lo stato corrente.', 'Rileggere lo stato e conservare gli esiti già conclusi.', false],
  BUSY: ['Operazione già in corso.', 'Interrogare la richiesta attiva o riprovare.', true],
  BLOCKED: ['Operazione bloccata per sicurezza.', 'Verificare risorse e diagnostica prima del retry.', true],
  EVENT_BACKPRESSURE: ['Osservabilità bloccata: il batch precedente non è drenato.', 'Consultare diagnostics e preservare il journal prima di riprovare.', true],
  PERSISTENCE_UNAVAILABLE: ['Stato persistente non disponibile.', 'Verificare spazio, permessi e disponibilità del disco.', true],
  STATE_INCOMPATIBLE: ['Versione dello stato non compatibile.', 'Usare una versione compatibile senza ricreare lo stato.', false],
  STATE_ABSENT: ['Archivio locale assente.', 'Avviare esplicitamente il daemon per inizializzare lo stato.', false],
  REGISTRY_NOT_INITIALIZED: ['Registro progetti non inizializzato.', 'Eseguire daemon start esplicito per aggiornare lo schema.', false],
  STATE_CORRUPT: ['Integrità dello stato non verificabile.', 'Preservare i file e richiedere un intervento manuale.', false],
  DEADLINE_EXCEEDED: ['Attesa conclusa senza esito verificato.', 'Interrogare il requestId; non ripetere effetti alla cieca.', true],
  RESOURCE_IDENTITY_UNKNOWN: ['Proprietà di una risorsa non verificata.', 'Verificare la risorsa senza terminare processi da un PID salvato.', true],
  ENDPOINT_COLLISION: ['Endpoint locale già occupato o incerto.', 'Verificare proprietario e stato senza eliminare artefatti estranei.', false],
  CURSOR_EXPIRED: ['Parte degli eventi non è più conservata.', 'Rileggere lo stato e scegliere da dove riprendere.', false],
  WRONG_STORE: ['Cursore riferito a un altro archivio.', 'Usare il cursore dell’archivio corrente.', false],
  SLOW_CONSUMER: ['Osservatore scollegato per limite del buffer.', 'Riprendere con il cursore dell’ultimo evento ricevuto.', true],
  DAEMON_ABSENT: ['Il processo del daemon risulta cessato.', 'Eseguire un controllo esplicito per riconciliare lo stato salvato.', true],
  SERVICE_UNREACHABLE: ['Servizio locale non raggiungibile.', 'Interrogare status e conservare l’ultima sequenza ricevuta.', true],
  CONTROL_INTERRUPTED: ['Controller terminato senza esito verificato.', 'Interrogare e riprovare lo stesso requestId per riconciliare l’esito.', true],
  CORE_EXITED_BEFORE_ACCEPTANCE: ['Core terminato prima della conferma di accettazione.', 'Verificare runtime e interrogare il requestId.', true],
  INTERNAL_ERROR: ['Errore interno non classificato.', 'Consultare la diagnostica redatta e preservare lo stato.', false],
} as const;

export type ErrorCode = keyof typeof catalog;
export type ErrorCategory = 'VALIDATION' | 'AUTHORIZATION' | 'CONCURRENCY' | 'SAFETY' | 'PERSISTENCE' | 'TIMEOUT' | 'OBSERVABILITY' | 'RUNTIME';
const categories: Record<ErrorCode, ErrorCategory> = {
  APPROVAL_REQUIRED: 'AUTHORIZATION',
  APPROVAL_STALE: 'AUTHORIZATION',
  ANSWER_CONFLICT: 'CONCURRENCY',
  CHECK_EXPIRED: 'VALIDATION',
  ARTIFACT_CORRUPT: 'SAFETY',
  CONTEXT_CHANGED: 'SAFETY',
  CONTEXT_UNSTABLE: 'SAFETY',
  CONTEXT_LIMIT: 'VALIDATION',
  SOURCE_EXCLUDED: 'SAFETY',
  DISCOVERY_BUSY: 'CONCURRENCY',
  DISCOVERY_LIMIT: 'PERSISTENCE',
  PROVIDER_NOT_CONFIGURED: 'RUNTIME',
  PROVIDER_AUTH_REQUIRED: 'AUTHORIZATION',
  PROVIDER_UNSUPPORTED: 'RUNTIME',
  PROVIDER_UNSAFE: 'SAFETY',
  PROVIDER_UNAVAILABLE: 'RUNTIME',
  PROVIDER_QUOTA: 'RUNTIME',
  PROVIDER_PROTOCOL_ERROR: 'RUNTIME',
  PROVIDER_OUTPUT_LIMIT: 'RUNTIME',
  PROVIDER_CONTEXT_LIMIT: 'VALIDATION',
  DISCOVERY_NOT_INITIALIZED: 'RUNTIME',
  INVALID_REQUEST: 'VALIDATION', UNSUPPORTED_VERSION: 'VALIDATION', UNSUPPORTED_PLATFORM: 'VALIDATION',
  UNAUTHORIZED: 'AUTHORIZATION', STALE_TARGET: 'AUTHORIZATION', IDEMPOTENCY_CONFLICT: 'CONCURRENCY', INVALID_TRANSITION: 'CONCURRENCY',
  INVALID_NAME: 'VALIDATION', INVALID_BASE_BRANCH: 'VALIDATION', PATH_ACCESS_DENIED: 'AUTHORIZATION',
  REVISION_CONFLICT: 'CONCURRENCY', OBSERVATION_SUPERSEDED: 'CONCURRENCY', REGISTRY_CHANGED: 'CONCURRENCY',
  REPOSITORY_NOT_FOUND: 'RUNTIME', REFERENCE_CHECKOUT_UNAVAILABLE: 'RUNTIME', REPOSITORY_UNSUPPORTED: 'RUNTIME', GIT_UNAVAILABLE: 'RUNTIME',
  REPOSITORY_CHANGED: 'SAFETY', REPOSITORY_UNSTABLE: 'SAFETY', INSPECTION_UNAVAILABLE: 'SAFETY', INSPECTION_UNSAFE: 'SAFETY',
  UNKNOWN_OUTCOME: 'TIMEOUT', OUTPUT_LIMIT: 'RUNTIME', PROJECT_NOT_FOUND: 'RUNTIME', PROJECT_REMOVED: 'RUNTIME', DAEMON_UNAVAILABLE: 'RUNTIME',
  INTERRUPTED: 'RUNTIME',
  OPERATION_NOT_FOUND: 'RUNTIME',
  BUSY: 'CONCURRENCY', BLOCKED: 'SAFETY', EVENT_BACKPRESSURE: 'OBSERVABILITY',
  PERSISTENCE_UNAVAILABLE: 'PERSISTENCE', STATE_INCOMPATIBLE: 'PERSISTENCE', STATE_CORRUPT: 'PERSISTENCE',
  STATE_ABSENT: 'RUNTIME', REGISTRY_NOT_INITIALIZED: 'RUNTIME',
  DEADLINE_EXCEEDED: 'TIMEOUT', RESOURCE_IDENTITY_UNKNOWN: 'SAFETY', ENDPOINT_COLLISION: 'SAFETY',
  CURSOR_EXPIRED: 'OBSERVABILITY', WRONG_STORE: 'VALIDATION', SLOW_CONSUMER: 'OBSERVABILITY',
  DAEMON_ABSENT: 'RUNTIME', SERVICE_UNREACHABLE: 'RUNTIME', CONTROL_INTERRUPTED: 'RUNTIME',
  CORE_EXITED_BEFORE_ACCEPTANCE: 'RUNTIME', INTERNAL_ERROR: 'RUNTIME',
};
export type FailureCause = 'DISK_FULL' | 'READ_ONLY' | 'IO_ERROR' | 'WORKER_EXIT' | 'CORRUPT' | 'INCOMPATIBLE' | 'PROCESS_EXIT' | 'IDENTITY_UNVERIFIED' | null;
export interface ErrorContext { readonly operationId?: string; readonly persisted?: boolean; readonly cause?: FailureCause }
export interface SafeError {
  readonly code: ErrorCode;
  readonly category: ErrorCategory;
  readonly cause: FailureCause;
  readonly message: string;
  readonly nextAction: string;
  readonly retryable: boolean;
  readonly persisted: boolean;
  readonly operationId: string | null;
}

export function foundationError(code: ErrorCode, context: ErrorContext = {}): SafeError {
  if (!Object.hasOwn(catalog, code)) throw new Error('INVALID_ERROR_CODE');
  const [message, nextAction, retryable] = catalog[code];
  const operationId = context.operationId ?? null;
  if (context.cause != null && !['DISK_FULL', 'READ_ONLY', 'IO_ERROR', 'WORKER_EXIT', 'CORRUPT', 'INCOMPATIBLE', 'PROCESS_EXIT', 'IDENTITY_UNVERIFIED'].includes(context.cause)) throw new Error('INVALID_ERROR_CODE');
  if (operationId !== null && !/^[0-9a-f-]{36}$/i.test(operationId)) throw new Error('INVALID_IDENTIFIER');
  return Object.freeze({ code, category: categories[code], message, nextAction, retryable, cause: context.cause ?? null, persisted: context.persisted ?? false, operationId });
}
