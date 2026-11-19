export const DISCOVERY_TABLES = Object.freeze(['discovery_provider', 'discovery_artifacts', 'discovery_snapshots', 'discoveries', 'discovery_operations', 'discovery_grants', 'discovery_runs', 'discovery_slot', 'discovery_processes', 'discovery_questions', 'discovery_answers', 'discovery_revisions', 'discovery_approvals', 'discovery_output', 'discovery_budget'] as const);
/** Version4 adds only Discovery-owned tables. Historical registry SQL remains frozen. */
export const DISCOVERY_SCHEMA_SQL = `
CREATE TABLE discovery_provider (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1),
  config_revision INTEGER NOT NULL CHECK(config_revision>0),
  configuration TEXT NOT NULL CHECK(json_valid(configuration) AND length(CAST(configuration AS BLOB))<=8192)
) STRICT;
CREATE TABLE discovery_artifacts (
  artifact_id TEXT PRIMARY KEY CHECK(length(artifact_id)=36),
  kind TEXT NOT NULL CHECK(kind IN ('MANIFEST','CORPUS','DOCUMENT','OUTPUT','EXIT_PROOF')),
  relative_key TEXT NOT NULL UNIQUE CHECK(length(relative_key)=36),
  sha256 TEXT CHECK(sha256 IS NULL OR length(sha256)=64),
  allocated_bytes INTEGER NOT NULL CHECK(allocated_bytes>=0 AND allocated_bytes<=67108864),
  state TEXT NOT NULL CHECK(state IN ('RESERVED','PUBLISHED','REFERENCED','ORPHAN','CORRUPT')),
  ref_count INTEGER NOT NULL DEFAULT 0 CHECK(ref_count>=0), committed_at TEXT,
  CHECK(state NOT IN ('PUBLISHED','REFERENCED') OR sha256 IS NOT NULL)
) STRICT;
CREATE TABLE discovery_snapshots (
  snapshot_id TEXT PRIMARY KEY CHECK(length(snapshot_id)=36),
  project_id TEXT NOT NULL REFERENCES projects(project_id), config_revision INTEGER NOT NULL CHECK(config_revision>0),
  state TEXT NOT NULL CHECK(state IN ('PREPARING','SEALED','INVALID')),
  context_digest TEXT CHECK(context_digest IS NULL OR length(context_digest)=64),
  manifest_artifact_id TEXT REFERENCES discovery_artifacts(artifact_id),
  corpus_artifact_id TEXT REFERENCES discovery_artifacts(artifact_id),
  created_at TEXT NOT NULL, expires_at_ms INTEGER, pinned INTEGER NOT NULL DEFAULT 0 CHECK(pinned IN (0,1)),
  metadata TEXT NOT NULL CHECK(json_valid(metadata) AND length(CAST(metadata AS BLOB))<=32768),
  CHECK(pinned=0 OR expires_at_ms IS NULL),
  CHECK(state<>'SEALED' OR (context_digest IS NOT NULL AND manifest_artifact_id IS NOT NULL AND corpus_artifact_id IS NOT NULL))
) STRICT;
CREATE TABLE discoveries (
  discovery_id TEXT PRIMARY KEY CHECK(length(discovery_id)=36), project_id TEXT NOT NULL REFERENCES projects(project_id),
  session_id TEXT NOT NULL UNIQUE CHECK(length(session_id)=36),
  state TEXT NOT NULL CHECK(state IN ('PREPARING','READY_TO_START','RUNNING','WAITING_USER','READY_FOR_REVIEW','UPDATING','APPROVED','STALE','FAILED','CANCELLED','INTERRUPTED','CANCELLING','RECONCILING')),
  state_revision INTEGER NOT NULL CHECK(state_revision>0), snapshot_id TEXT NOT NULL REFERENCES discovery_snapshots(snapshot_id),
  config_revision INTEGER NOT NULL CHECK(config_revision>0), provider_revision INTEGER NOT NULL CHECK(provider_revision>0),
  current_run_id TEXT REFERENCES discovery_runs(run_id) DEFERRABLE INITIALLY DEFERRED,
  latest_document_revision_id TEXT REFERENCES discovery_revisions(revision_id),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, error TEXT
) STRICT;
CREATE INDEX discovery_by_project ON discoveries(project_id,created_at,discovery_id);
CREATE TABLE discovery_operations (
  request_id TEXT PRIMARY KEY CHECK(length(request_id)=36),
  action TEXT NOT NULL CHECK(action IN ('configure','start','answer','correct','approve','cancel','preview','check','discard')),
  payload_hash TEXT NOT NULL CHECK(length(payload_hash)=64),
  canonical_intent TEXT NOT NULL CHECK(json_valid(canonical_intent) AND length(CAST(canonical_intent AS BLOB))<=32768),
  owner_uid INTEGER NOT NULL CHECK(owner_uid>=0), owning_instance_id TEXT NOT NULL REFERENCES instances(instance_id),
  phase TEXT NOT NULL CHECK(phase IN ('ACCEPTED','WORKING','FINALIZED')),
  outcome TEXT NOT NULL CHECK(outcome IN ('IN_PROGRESS','SUCCEEDED','FAILED','BLOCKED','INTERRUPTED','UNKNOWN')),
  accepted_at TEXT NOT NULL, completed_at TEXT,
  discovery_id TEXT REFERENCES discoveries(discovery_id) DEFERRABLE INITIALLY DEFERRED,
  run_id TEXT REFERENCES discovery_runs(run_id) DEFERRABLE INITIALLY DEFERRED,
  result TEXT CHECK(result IS NULL OR (json_valid(result) AND length(CAST(result AS BLOB))<=8192)), error TEXT,
  CHECK((phase='FINALIZED' AND completed_at IS NOT NULL AND outcome<>'IN_PROGRESS') OR (phase<>'FINALIZED' AND completed_at IS NULL))
) STRICT;
CREATE INDEX discovery_pending_operations ON discovery_operations(owning_instance_id,accepted_at) WHERE phase<>'FINALIZED';
CREATE TABLE discovery_grants (
  grant_id TEXT PRIMARY KEY CHECK(length(grant_id)=36),
  canonical_intent TEXT NOT NULL CHECK(json_valid(canonical_intent) AND length(CAST(canonical_intent AS BLOB))<=32768),
  expires_at_ms INTEGER NOT NULL CHECK(expires_at_ms>=0),
  consumed_by_request_id TEXT UNIQUE REFERENCES discovery_operations(request_id) DEFERRABLE INITIALLY DEFERRED
) STRICT;
CREATE TABLE discovery_runs (
  run_id TEXT PRIMARY KEY CHECK(length(run_id)=36), discovery_id TEXT NOT NULL REFERENCES discoveries(discovery_id),
  generation TEXT NOT NULL UNIQUE CHECK(length(generation)=36), turn_index INTEGER NOT NULL CHECK(turn_index BETWEEN 1 AND 20),
  grant_id TEXT NOT NULL REFERENCES discovery_grants(grant_id), request_id TEXT NOT NULL UNIQUE REFERENCES discovery_operations(request_id),
  context_digest TEXT NOT NULL CHECK(length(context_digest)=64), input_digest TEXT NOT NULL CHECK(length(input_digest)=64),
  provider_id TEXT NOT NULL, provider_revision INTEGER NOT NULL CHECK(provider_revision>0),
  profile_digest TEXT NOT NULL CHECK(length(profile_digest)=64), model_id TEXT NOT NULL,
  phase TEXT NOT NULL CHECK(phase IN ('SPAWN_INTENT','HOST_READY','SPAWN_AUTHORIZED','PROVIDER_RUNNING','EXIT_OBSERVED','FINALIZED')),
  outcome TEXT NOT NULL CHECK(outcome IN ('RUNNING','SUCCEEDED','FAILED','CANCELLED','INTERRUPTED','TIMED_OUT','UNKNOWN')),
  started_at TEXT, ended_at TEXT, output_watermark INTEGER NOT NULL DEFAULT 0 CHECK(output_watermark>=0), error TEXT,
  UNIQUE(discovery_id,turn_index)
) STRICT;
CREATE TABLE discovery_slot (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1), discovery_id TEXT UNIQUE REFERENCES discoveries(discovery_id), acquired_at TEXT,
  CHECK((discovery_id IS NULL)=(acquired_at IS NULL))
) STRICT;
INSERT INTO discovery_slot(singleton) VALUES(1);
CREATE TABLE discovery_processes (
  run_id TEXT PRIMARY KEY REFERENCES discovery_runs(run_id), generation TEXT NOT NULL CHECK(length(generation)=36),
  owning_instance_id TEXT NOT NULL REFERENCES instances(instance_id), host_pid INTEGER CHECK(host_pid IS NULL OR host_pid>0),
  provider_pid INTEGER CHECK(provider_pid IS NULL OR provider_pid>0), host_endpoint TEXT NOT NULL, credential_ref TEXT NOT NULL,
  policy_scope TEXT NOT NULL DEFAULT 'agent-runtime' CHECK(policy_scope='agent-runtime'), policy TEXT NOT NULL,
  observation TEXT NOT NULL CHECK(observation IN ('VERIFIED','ABSENT','UNKNOWN')),
  release_state TEXT NOT NULL CHECK(release_state IN ('OWNED','RELEASED','BLOCKED'))
) STRICT;
CREATE TABLE discovery_questions (
  question_id TEXT PRIMARY KEY CHECK(length(question_id)=36), discovery_id TEXT NOT NULL REFERENCES discoveries(discovery_id),
  originating_run_id TEXT NOT NULL REFERENCES discovery_runs(run_id), question_revision INTEGER NOT NULL CHECK(question_revision>0),
  text TEXT NOT NULL CHECK(length(CAST(text AS BLOB)) BETWEEN 1 AND 4096),
  reason TEXT NOT NULL CHECK(length(CAST(reason AS BLOB))<=4096), section TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('OPEN','ANSWERED','UNKNOWN_ACCEPTED'))
) STRICT;
CREATE TABLE discovery_answers (
  answer_id TEXT PRIMARY KEY CHECK(length(answer_id)=36), question_id TEXT NOT NULL REFERENCES discovery_questions(question_id),
  question_revision INTEGER NOT NULL CHECK(question_revision>0), request_id TEXT NOT NULL UNIQUE REFERENCES discovery_operations(request_id),
  answer_revision INTEGER NOT NULL CHECK(answer_revision>0),
  value TEXT NOT NULL CHECK(length(CAST(value AS BLOB))<=4096), kind TEXT NOT NULL CHECK(kind IN ('ANSWER','UNKNOWN')),
  user_confirmed_at TEXT NOT NULL, UNIQUE(question_id,answer_revision)
) STRICT;
CREATE TABLE discovery_revisions (
  revision_id TEXT PRIMARY KEY CHECK(length(revision_id)=36), discovery_id TEXT NOT NULL REFERENCES discoveries(discovery_id),
  revision_number INTEGER NOT NULL CHECK(revision_number>0), parent_revision_id TEXT REFERENCES discovery_revisions(revision_id),
  snapshot_id TEXT NOT NULL REFERENCES discovery_snapshots(snapshot_id), context_digest TEXT NOT NULL CHECK(length(context_digest)=64),
  bundle_artifact_id TEXT NOT NULL REFERENCES discovery_artifacts(artifact_id), bundle_digest TEXT NOT NULL CHECK(length(bundle_digest)=64),
  bytes INTEGER NOT NULL CHECK(bytes BETWEEN 1 AND 262144), provenance_validated INTEGER NOT NULL CHECK(provenance_validated IN (0,1)),
  status TEXT NOT NULL CHECK(status IN ('DRAFT','READY_FOR_REVIEW','INVALID')),
  UNIQUE(discovery_id,revision_number), CHECK(status<>'READY_FOR_REVIEW' OR provenance_validated=1)
) STRICT;
CREATE TABLE discovery_approvals (
  approval_id TEXT PRIMARY KEY CHECK(length(approval_id)=36), request_id TEXT NOT NULL UNIQUE REFERENCES discovery_operations(request_id),
  revision_id TEXT NOT NULL REFERENCES discovery_revisions(revision_id), discovery_id TEXT NOT NULL REFERENCES discoveries(discovery_id),
  project_id TEXT NOT NULL REFERENCES projects(project_id), config_revision INTEGER NOT NULL CHECK(config_revision>0),
  bundle_digest TEXT NOT NULL CHECK(length(bundle_digest)=64), context_digest TEXT NOT NULL CHECK(length(context_digest)=64),
  accepted_unknown_ids TEXT NOT NULL CHECK(json_valid(accepted_unknown_ids) AND length(CAST(accepted_unknown_ids AS BLOB))<=32768),
  owner_uid INTEGER NOT NULL CHECK(owner_uid>=0), approved_at TEXT NOT NULL, checked_at TEXT NOT NULL
) STRICT;
CREATE TABLE discovery_output (
  run_id TEXT NOT NULL REFERENCES discovery_runs(run_id), seq INTEGER NOT NULL CHECK(seq>0),
  artifact_id TEXT NOT NULL UNIQUE REFERENCES discovery_artifacts(artifact_id), sha256 TEXT NOT NULL CHECK(length(sha256)=64),
  bytes INTEGER NOT NULL CHECK(bytes BETWEEN 1 AND 8192), kind TEXT NOT NULL CHECK(kind IN ('PROGRESS','AGENT_TEXT')),
  created_at TEXT NOT NULL, truncated INTEGER NOT NULL CHECK(truncated IN (0,1)), PRIMARY KEY(run_id,seq)
) STRICT;
CREATE TABLE discovery_budget (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1),
  allocated_bytes INTEGER NOT NULL DEFAULT 0 CHECK(allocated_bytes>=0),
  reserved_bytes INTEGER NOT NULL DEFAULT 0 CHECK(reserved_bytes>=0),
  metadata_bytes INTEGER NOT NULL DEFAULT 0 CHECK(metadata_bytes>=0),
  allocated_files INTEGER NOT NULL DEFAULT 0 CHECK(allocated_files BETWEEN 0 AND 4096),
  reserved_files INTEGER NOT NULL DEFAULT 0 CHECK(reserved_files BETWEEN 0 AND 4096),
  CHECK(allocated_bytes+reserved_bytes+metadata_bytes<=67108864), CHECK(allocated_files+reserved_files<=4096)
) STRICT;
INSERT INTO discovery_budget(singleton) VALUES(1);
CREATE TRIGGER discovery_uuid_guard BEFORE INSERT ON discovery_operations
WHEN EXISTS(SELECT 1 FROM request_catalog WHERE request_id=NEW.request_id)
BEGIN SELECT RAISE(ABORT,'IDEMPOTENCY_CONFLICT'); END;
CREATE TRIGGER catalog_discovery_uuid_guard BEFORE INSERT ON request_catalog
WHEN EXISTS(SELECT 1 FROM discovery_operations WHERE request_id=NEW.request_id)
BEGIN SELECT RAISE(ABORT,'IDEMPOTENCY_CONFLICT'); END;
CREATE TRIGGER immutable_discovery_identity BEFORE UPDATE ON discoveries
WHEN NEW.discovery_id<>OLD.discovery_id OR NEW.project_id<>OLD.project_id OR NEW.session_id<>OLD.session_id
  OR NEW.snapshot_id<>OLD.snapshot_id OR NEW.config_revision<>OLD.config_revision OR NEW.provider_revision<>OLD.provider_revision OR NEW.created_at<>OLD.created_at
BEGIN SELECT RAISE(ABORT,'INVALID_TRANSITION'); END;
CREATE TRIGGER immutable_discovery_intent BEFORE UPDATE ON discovery_operations
WHEN NEW.request_id<>OLD.request_id OR NEW.action<>OLD.action OR NEW.payload_hash<>OLD.payload_hash
  OR NEW.canonical_intent<>OLD.canonical_intent OR NEW.owner_uid<>OLD.owner_uid OR NEW.owning_instance_id<>OLD.owning_instance_id OR NEW.accepted_at<>OLD.accepted_at
BEGIN SELECT RAISE(ABORT,'INVALID_TRANSITION'); END;
CREATE TRIGGER immutable_discovery_terminal BEFORE UPDATE ON discovery_operations WHEN OLD.phase='FINALIZED'
BEGIN SELECT RAISE(ABORT,'INVALID_TRANSITION'); END;
CREATE TRIGGER immutable_discovery_grant BEFORE UPDATE ON discovery_grants
WHEN NEW.grant_id<>OLD.grant_id OR NEW.canonical_intent<>OLD.canonical_intent OR NEW.expires_at_ms<>OLD.expires_at_ms
  OR OLD.consumed_by_request_id IS NOT NULL
BEGIN SELECT RAISE(ABORT,'INVALID_TRANSITION'); END;
CREATE TRIGGER immutable_discovery_answer BEFORE UPDATE ON discovery_answers
BEGIN SELECT RAISE(ABORT,'INVALID_TRANSITION'); END;
CREATE TRIGGER immutable_discovery_revision BEFORE UPDATE ON discovery_revisions
BEGIN SELECT RAISE(ABORT,'INVALID_TRANSITION'); END;
CREATE TRIGGER immutable_discovery_approval BEFORE UPDATE ON discovery_approvals
BEGIN SELECT RAISE(ABORT,'INVALID_TRANSITION'); END;
CREATE TRIGGER validate_discovery_approval BEFORE INSERT ON discovery_approvals
WHEN NOT EXISTS(SELECT 1 FROM discoveries d JOIN discovery_revisions r ON r.discovery_id=d.discovery_id
  WHERE d.discovery_id=NEW.discovery_id AND d.project_id=NEW.project_id AND d.config_revision=NEW.config_revision
    AND d.state='READY_FOR_REVIEW' AND d.latest_document_revision_id=NEW.revision_id AND r.revision_id=NEW.revision_id
    AND r.status='READY_FOR_REVIEW' AND r.provenance_validated=1 AND r.bundle_digest=NEW.bundle_digest
    AND r.context_digest=NEW.context_digest AND r.snapshot_id=d.snapshot_id)
BEGIN SELECT RAISE(ABORT,'APPROVAL_STALE'); END;
CREATE TRIGGER retained_discoveries BEFORE DELETE ON discoveries BEGIN SELECT RAISE(ABORT,'INVALID_TRANSITION'); END;
CREATE TRIGGER retained_discovery_operations BEFORE DELETE ON discovery_operations BEGIN SELECT RAISE(ABORT,'INVALID_TRANSITION'); END;
CREATE TRIGGER retained_discovery_answers BEFORE DELETE ON discovery_answers BEGIN SELECT RAISE(ABORT,'INVALID_TRANSITION'); END;
CREATE TRIGGER retained_discovery_revisions BEFORE DELETE ON discovery_revisions BEGIN SELECT RAISE(ABORT,'INVALID_TRANSITION'); END;
CREATE TRIGGER retained_discovery_approvals BEFORE DELETE ON discovery_approvals BEGIN SELECT RAISE(ABORT,'INVALID_TRANSITION'); END;
`;
export function requireDiscoverySchema(version: number): void {
  if (![4,5,6].includes(version)) throw new Error('DISCOVERY_NOT_INITIALIZED');
}
