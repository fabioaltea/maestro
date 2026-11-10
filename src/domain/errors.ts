const catalog = {
  INVALID_REQUEST: ['Richiesta non valida.', 'Controllare argomenti e aiuto locale.', false],
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
  INVALID_REQUEST: 'VALIDATION', UNSUPPORTED_VERSION: 'VALIDATION', UNSUPPORTED_PLATFORM: 'VALIDATION',
  UNAUTHORIZED: 'AUTHORIZATION', STALE_TARGET: 'AUTHORIZATION', IDEMPOTENCY_CONFLICT: 'VALIDATION', INVALID_TRANSITION: 'CONCURRENCY',
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
