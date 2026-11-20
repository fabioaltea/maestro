import {PROFILE_SCHEMA_VERSION,PROFILES_SCHEMA_SQL,WORKFLOW_SCHEMA_V8_SQL} from './profiles-schema.js';
import {ENVIRONMENTS_SCHEMA_SQL,WORKFLOW_SCHEMA_V7_SQL} from './environments-schema.js';
import {WORKFLOW_SCHEMA_V6_SQL,WORKSPACES_SCHEMA_SQL} from './workspaces-schema.js';
import type Database from 'better-sqlite3';
import type { StoreIdentity } from '../ports/storage.js';
import { FEATURES_SCHEMA_SQL } from './features-schema.js';
import { DISCOVERY_SCHEMA_SQL } from './discovery-schema.js';
import { requireUuid } from '../domain/identifiers.js';

export const SCHEMA_VERSION = PROFILE_SCHEMA_VERSION;
export const REGISTRY_SCHEMA_VERSION = 3;
export const STORE_SCHEMA_V3_SQL = `
CREATE TABLE store (
  singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
  store_id TEXT NOT NULL UNIQUE,
  schema_version INTEGER NOT NULL CHECK(schema_version = 3),
  owner_uid INTEGER NOT NULL CHECK(owner_uid >= 0),
  canonical_path TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0),
  next_event_seq INTEGER NOT NULL DEFAULT 1 CHECK(next_event_seq > 0),
  current_instance_id TEXT REFERENCES instances(instance_id)
) STRICT;
`;
export const STORE_SCHEMA_SQL = STORE_SCHEMA_V3_SQL.replace('CHECK(schema_version = 3)', 'CHECK(schema_version = 4)');
// Frozen historical2→3 SQL. Add future migrations instead of editing this definition.
export const REGISTRY_SCHEMA_V3_SQL = `
CREATE TABLE request_catalog (
  request_id TEXT PRIMARY KEY CHECK(length(request_id)=36),
  scope TEXT NOT NULL CHECK(scope IN ('LIFECYCLE','PROJECT')),
  action TEXT NOT NULL,
  payload_hash TEXT NOT NULL CHECK(length(payload_hash)=64),
  CHECK((scope='LIFECYCLE' AND action IN ('start','stop','restart'))
    OR (scope='PROJECT' AND action IN ('REGISTER','VERIFY','UPDATE','REMOVE')))
) STRICT;
CREATE TABLE registry_metadata (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1),
  registry_revision INTEGER NOT NULL DEFAULT 0 CHECK(registry_revision>=0)
) STRICT;
INSERT INTO registry_metadata(singleton) VALUES(1);
CREATE TABLE projects (
  project_id TEXT PRIMARY KEY CHECK(length(project_id)=36),
  display_name TEXT NOT NULL CHECK(length(display_name)>0 AND length(display_name)<=120),
  repository_key TEXT NOT NULL CHECK(length(repository_key)=64),
  repository_identity TEXT NOT NULL CHECK(json_valid(repository_identity)),
  reference_checkout TEXT NOT NULL CHECK(json_valid(reference_checkout)),
  base_branch TEXT,
  config_revision INTEGER NOT NULL CHECK(config_revision>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  removed_at TEXT
) STRICT;
CREATE UNIQUE INDEX active_repository_identity ON projects(repository_key) WHERE removed_at IS NULL;
CREATE INDEX active_project_pages ON projects(project_id) WHERE removed_at IS NULL;
CREATE TABLE project_operations (
  request_id TEXT PRIMARY KEY REFERENCES request_catalog(request_id),
  action TEXT NOT NULL CHECK(action IN ('REGISTER','VERIFY','UPDATE','REMOVE')),
  payload_hash TEXT NOT NULL CHECK(length(payload_hash)=64),
  canonical_intent TEXT NOT NULL CHECK(json_valid(canonical_intent)),
  project_id TEXT REFERENCES projects(project_id),
  expected_config_revision INTEGER CHECK(expected_config_revision IS NULL OR expected_config_revision>0),
  owning_instance_id TEXT NOT NULL REFERENCES instances(instance_id),
  owner_uid INTEGER NOT NULL CHECK(owner_uid>=0),
  phase TEXT NOT NULL CHECK(phase IN ('ACCEPTED','PROBING','FINALIZED')),
  outcome TEXT NOT NULL CHECK(outcome IN ('IN_PROGRESS','SUCCEEDED','FAILED','BLOCKED','INTERRUPTED')),
  accepted_at TEXT NOT NULL,
  deadline_at TEXT NOT NULL,
  completed_at TEXT,
  result TEXT CHECK(result IS NULL OR json_valid(result)),
  CHECK((outcome='IN_PROGRESS' AND phase<>'FINALIZED' AND result IS NULL AND completed_at IS NULL)
    OR (outcome<>'IN_PROGRESS' AND phase='FINALIZED' AND result IS NOT NULL AND completed_at IS NOT NULL))
) STRICT;
CREATE INDEX registry_pending ON project_operations(owning_instance_id,accepted_at) WHERE outcome='IN_PROGRESS';
CREATE TABLE project_observations (
  project_id TEXT PRIMARY KEY REFERENCES projects(project_id),
  observation_revision INTEGER NOT NULL CHECK(observation_revision>0),
  observed_config_revision INTEGER NOT NULL CHECK(observed_config_revision>0),
  request_id TEXT NOT NULL REFERENCES project_operations(request_id),
  observed_instance_id TEXT NOT NULL REFERENCES instances(instance_id),
  started_at TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  evidence TEXT NOT NULL CHECK(json_valid(evidence))
) STRICT;
CREATE TRIGGER immutable_request_catalog BEFORE UPDATE ON request_catalog
BEGIN SELECT RAISE(ABORT,'INVALID_TRANSITION'); END;
CREATE TRIGGER retained_request_catalog BEFORE DELETE ON request_catalog
BEGIN SELECT RAISE(ABORT,'INVALID_TRANSITION'); END;
CREATE TRIGGER immutable_project_intent BEFORE UPDATE ON project_operations
WHEN NEW.request_id<>OLD.request_id OR NEW.action<>OLD.action OR NEW.payload_hash<>OLD.payload_hash
  OR NEW.canonical_intent<>OLD.canonical_intent OR NEW.owner_uid<>OLD.owner_uid
  OR NEW.owning_instance_id<>OLD.owning_instance_id OR NEW.accepted_at<>OLD.accepted_at
  OR NEW.deadline_at<>OLD.deadline_at OR NEW.expected_config_revision IS NOT OLD.expected_config_revision
BEGIN SELECT RAISE(ABORT,'INVALID_TRANSITION'); END;
CREATE TRIGGER immutable_project_terminal BEFORE UPDATE ON project_operations WHEN OLD.outcome<>'IN_PROGRESS'
BEGIN SELECT RAISE(ABORT,'INVALID_TRANSITION'); END;
CREATE TRIGGER retained_project_operations BEFORE DELETE ON project_operations
BEGIN SELECT RAISE(ABORT,'INVALID_TRANSITION'); END;
CREATE TRIGGER immutable_project_identity BEFORE UPDATE ON projects
WHEN NEW.project_id<>OLD.project_id OR NEW.repository_key<>OLD.repository_key
  OR NEW.repository_identity<>OLD.repository_identity OR NEW.reference_checkout<>OLD.reference_checkout
  OR NEW.created_at<>OLD.created_at OR OLD.removed_at IS NOT NULL
BEGIN SELECT RAISE(ABORT,'INVALID_TRANSITION'); END;
CREATE TRIGGER retained_projects BEFORE DELETE ON projects
BEGIN SELECT RAISE(ABORT,'INVALID_TRANSITION'); END;
`;
export const REGISTRY_SCHEMA_SQL = REGISTRY_SCHEMA_V3_SQL;
export const SCHEMA_V6_SQL = `${STORE_SCHEMA_SQL.replace('CHECK(schema_version = 4)', 'CHECK(schema_version = 6)')}
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
CREATE UNIQUE INDEX single_active_ticket ON launch_tickets(request_id)
  WHERE status IN ('ISSUED','CLAIMED');
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
CREATE TABLE event_outbox (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1),
  records TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(records) AND length(CAST(records AS BLOB))<=65536)
) STRICT;
INSERT INTO event_outbox(singleton) VALUES(1);
CREATE TABLE journal_metadata (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1),
  retention_floor INTEGER NOT NULL DEFAULT 1 CHECK(retention_floor>=1),
  high_water INTEGER NOT NULL DEFAULT 0 CHECK(high_water>=0),
  degraded_code TEXT
) STRICT;
INSERT INTO journal_metadata(singleton) VALUES(1);
CREATE INDEX resources_by_instance ON managed_resources(owning_instance_id, release_state);
${REGISTRY_SCHEMA_SQL}
${DISCOVERY_SCHEMA_SQL}
${WORKFLOW_SCHEMA_V6_SQL}
${FEATURES_SCHEMA_SQL}
${WORKSPACES_SCHEMA_SQL}`;
export const SCHEMA_V7_SQL = SCHEMA_V6_SQL.replace('CHECK(schema_version = 6)', 'CHECK(schema_version = 7)')
  .replace(WORKFLOW_SCHEMA_V6_SQL, WORKFLOW_SCHEMA_V7_SQL) + ENVIRONMENTS_SCHEMA_SQL;
export const SCHEMA_SQL=SCHEMA_V7_SQL.replace('CHECK(schema_version = 7)','CHECK(schema_version = 8)')
  .replace(WORKFLOW_SCHEMA_V7_SQL,WORKFLOW_SCHEMA_V8_SQL)+PROFILES_SCHEMA_SQL;

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
