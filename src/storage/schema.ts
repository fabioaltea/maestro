import type Database from 'better-sqlite3';
import type { StoreIdentity } from '../ports/storage.js';
import { requireUuid } from '../domain/identifiers.js';

export const SCHEMA_VERSION = 1;
export const SCHEMA_SQL = `
CREATE TABLE store (
  singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
  store_id TEXT NOT NULL UNIQUE,
  schema_version INTEGER NOT NULL CHECK(schema_version = 1),
  owner_uid INTEGER NOT NULL CHECK(owner_uid >= 0),
  canonical_path TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0),
  next_event_seq INTEGER NOT NULL DEFAULT 1 CHECK(next_event_seq > 0),
  current_instance_id TEXT REFERENCES instances(instance_id)
) STRICT;
CREATE TABLE instances (
  instance_id TEXT PRIMARY KEY,
  pid INTEGER NOT NULL CHECK(pid > 0),
  generation TEXT NOT NULL,
  lifecycle TEXT NOT NULL CHECK(lifecycle IN ('STOPPED','STARTING','RECOVERING','RUNNING','STOPPING','BLOCKED')),
  started_at TEXT NOT NULL,
  shutdown_prepared INTEGER NOT NULL DEFAULT 0 CHECK(shutdown_prepared IN (0,1)),
  last_error TEXT CHECK(last_error IS NULL OR json_valid(last_error))
) STRICT;
CREATE TABLE operations (
  request_id TEXT PRIMARY KEY,
  action TEXT NOT NULL CHECK(action IN ('start','stop','restart')),
  payload_hash TEXT NOT NULL CHECK(length(payload_hash) = 64),
  owner_uid INTEGER NOT NULL CHECK(owner_uid >= 0),
  target_instance_id TEXT,
  successor_instance_id TEXT,
  phase TEXT NOT NULL CHECK(phase IN ('ACCEPTED','PRECHECK','SPAWN_INTENT','WAIT_READY','STOP_REQUESTED','DRAINING','WAIT_EXIT','FINALIZED')),
  outcome TEXT NOT NULL CHECK(outcome IN ('IN_PROGRESS','SUCCEEDED','INTERRUPTED','FAILED','BLOCKED')),
  accepted_at TEXT NOT NULL,
  completed_at TEXT,
  error TEXT CHECK(error IS NULL OR json_valid(error))
) STRICT;
CREATE UNIQUE INDEX single_pending_operation ON operations((1))
  WHERE outcome IN ('IN_PROGRESS','BLOCKED');
CREATE TABLE controller_attempts (
  attempt_id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES operations(request_id),
  pid INTEGER NOT NULL CHECK(pid > 0),
  generation TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  result TEXT
) STRICT;
CREATE INDEX controller_by_request ON controller_attempts(request_id);
CREATE TABLE launch_tickets (
  ticket_id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES operations(request_id),
  instance_id TEXT NOT NULL,
  generation TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('ISSUED','CLAIMED','CANCELLED')),
  claimed_pid INTEGER CHECK(claimed_pid IS NULL OR claimed_pid > 0),
  CHECK((status = 'CLAIMED') = (claimed_pid IS NOT NULL)),
  UNIQUE(instance_id, generation)
) STRICT;
CREATE INDEX ticket_by_request ON launch_tickets(request_id);
CREATE TABLE managed_resources (
  resource_id TEXT PRIMARY KEY,
  owning_instance_id TEXT NOT NULL REFERENCES instances(instance_id),
  kind TEXT NOT NULL CHECK(kind IN ('auxiliary','socket','temp')),
  policy_scope TEXT NOT NULL CHECK(policy_scope = 'foundation'),
  generation TEXT NOT NULL,
  pid INTEGER CHECK(pid IS NULL OR pid > 0),
  endpoint TEXT,
  credential_ref TEXT,
  observation TEXT NOT NULL CHECK(observation IN ('VERIFIED','ABSENT','UNKNOWN')),
  release_state TEXT NOT NULL CHECK(release_state IN ('OWNED','RELEASED','BLOCKED'))
) STRICT;
CREATE INDEX resources_by_instance ON managed_resources(owning_instance_id, release_state);
`;

export function initializeSchema(database: Database.Database, identity: StoreIdentity): void {
  requireUuid(identity.storeId);
  if (identity.schemaVersion !== SCHEMA_VERSION || identity.revision !== '0'
    || !Number.isSafeInteger(identity.ownerUid) || identity.ownerUid < 0
    || !identity.canonicalPath.startsWith('/')) throw new Error('INVALID_REQUEST');
  database.transaction(() => {
    const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all();
    if (tables.length || database.pragma('user_version', { simple: true }) !== 0) {
      throw new Error('STATE_INCOMPATIBLE');
    }
    database.exec(SCHEMA_SQL);
    database.prepare('INSERT INTO store(singleton,store_id,schema_version,owner_uid,canonical_path) VALUES (1,?,?,?,?)')
      .run(identity.storeId, SCHEMA_VERSION, identity.ownerUid, identity.canonicalPath);
    database.pragma(`user_version = ${SCHEMA_VERSION}`);
  })();
}
