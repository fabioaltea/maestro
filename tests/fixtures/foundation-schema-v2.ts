// Frozen schema of this greenfield Foundation v2; never derive it from the current schema.
import Database from 'better-sqlite3';
import { chmodSync } from 'node:fs';
import { join } from 'node:path';

export const FOUNDATION_V2_SQL = `
CREATE TABLE store (
  singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
  store_id TEXT NOT NULL UNIQUE,
  schema_version INTEGER NOT NULL CHECK(schema_version = 2),
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
`;
export function createFoundationV2(directory: string): { path: string; storeId: string; requestId: string } {
  const path = join(directory, 'state.sqlite');
  const database = new Database(path);
  chmodSync(path, 0o600);
  const storeId = '25c6b95f-253b-49c4-9825-ff0abbe98f3a';
  const requestId = '5fc02636-f95e-4ee8-9969-2a7e0c2478f0';
  try {
    database.exec(FOUNDATION_V2_SQL);
    database.prepare('INSERT INTO instances(instance_id,pid,generation,lifecycle,started_at) VALUES(?,?,?,?,?)')
      .run('234ce67a-4316-4b24-bff6-d13a97f47888', 12345, 'fixture-generation', 'STOPPED', '2026-11-10T10:00:00.000Z');
    database.prepare('INSERT INTO store(singleton,store_id,schema_version,owner_uid,canonical_path,revision,next_event_seq,current_instance_id) VALUES(1,?,2,?,?,7,43,?)')
      .run(storeId, process.getuid!(), directory, '234ce67a-4316-4b24-bff6-d13a97f47888');
    database.prepare("INSERT INTO operations(request_id,action,payload_hash,owner_uid,phase,outcome,accepted_at,completed_at) VALUES(?,'start',?,?,'FINALIZED','SUCCEEDED',?,?)")
      .run(requestId, 'a'.repeat(64), process.getuid!(), '2026-11-10T10:00:00.000Z', '2026-11-10T10:00:01.000Z');
    database.prepare("INSERT INTO launch_tickets(ticket_id,request_id,instance_id,generation,status) VALUES(?,?,?,?,'CANCELLED')")
      .run('a26be691-4445-41d8-bef6-d522d1e0be48', requestId, '234ce67a-4316-4b24-bff6-d13a97f47888', 'fixture-generation');
    database.prepare("INSERT INTO controller_attempts(attempt_id,request_id,pid,generation,started_at,ended_at,result) VALUES(?,?,12345,'fixture',?,?,'SUCCEEDED')")
      .run('345caeb6-a3ce-4fd2-8558-fce8486a6bc5', requestId, '2026-11-10T10:00:00.000Z', '2026-11-10T10:00:01.000Z');
    database.prepare("INSERT INTO managed_resources(resource_id,owning_instance_id,kind,policy_scope,generation,observation,release_state) VALUES(?,?,'auxiliary','foundation','fixture','ABSENT','RELEASED')")
      .run('2f30be90-bc81-4562-bcda-714f1c50b65a', '234ce67a-4316-4b24-bff6-d13a97f47888');
    const event = { protocolVersion: 1, storeId, eventId: 'fbd93dc5-bac0-471f-9a35-2d4a2d5e8242', seq: '42',
      occurredAt: '2026-11-10T10:00:01.000Z', instanceId: null, operationId: requestId,
      type: 'operation.completed', payload: { outcome: 'SUCCEEDED' } };
    database.prepare('UPDATE event_outbox SET records=?').run(JSON.stringify([event]));
    database.prepare('UPDATE journal_metadata SET high_water=41,retention_floor=12,degraded_code=?').run('PERSISTENCE_UNAVAILABLE');
    database.pragma('user_version = 2');
    database.pragma('journal_mode = WAL');
    database.pragma('synchronous = FULL');
  } finally { database.close(); }
  return { path, storeId, requestId };
}
