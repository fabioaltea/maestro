/** Workflow tables are owned by the same SQLite writer; no secondary database. */
export const WORKFLOW_SCHEMA_SQL=`
CREATE TABLE workflow_operations (
 request_id TEXT PRIMARY KEY CHECK(length(request_id)=36), namespace TEXT NOT NULL CHECK(namespace IN ('FEATURE','ARTIFACT')),
 action TEXT NOT NULL,payload_hash TEXT NOT NULL CHECK(length(payload_hash)=64),canonical_intent TEXT NOT NULL CHECK(json_valid(canonical_intent) AND length(CAST(canonical_intent AS BLOB))<=32768),
 owner_uid INTEGER NOT NULL CHECK(owner_uid>=0),owning_instance_id TEXT NOT NULL REFERENCES instances(instance_id),
 phase TEXT NOT NULL CHECK(phase IN ('ACCEPTED','WORKING','FINALIZED')),outcome TEXT NOT NULL CHECK(outcome IN ('IN_PROGRESS','SUCCEEDED','FAILED','BLOCKED','INTERRUPTED','UNKNOWN')),
 target_id TEXT,accepted_at TEXT NOT NULL,completed_at TEXT,result TEXT CHECK(result IS NULL OR (json_valid(result) AND length(CAST(result AS BLOB))<=8192)),error TEXT,
 CHECK((phase='FINALIZED' AND completed_at IS NOT NULL AND outcome<>'IN_PROGRESS') OR (phase<>'FINALIZED' AND completed_at IS NULL))
) STRICT;
CREATE INDEX workflow_pending ON workflow_operations(owning_instance_id,phase);
CREATE TABLE workflow_grants (
 grant_id TEXT PRIMARY KEY CHECK(length(grant_id)=36),canonical_intent TEXT NOT NULL CHECK(json_valid(canonical_intent) AND length(CAST(canonical_intent AS BLOB))<=32768),
 created_at_ms INTEGER NOT NULL,expires_at_ms INTEGER NOT NULL CHECK(expires_at_ms>created_at_ms AND expires_at_ms-created_at_ms<=300000),
 consumed_by_request_id TEXT UNIQUE REFERENCES workflow_operations(request_id) DEFERRABLE INITIALLY DEFERRED
) STRICT;
CREATE TABLE workflow_artifacts (
 artifact_id TEXT PRIMARY KEY CHECK(length(artifact_id)=36),kind TEXT NOT NULL CHECK(kind IN ('BUNDLE','OUTPUT','INPUT','CHECKPOINT')),
 target_id TEXT,expected_bytes INTEGER NOT NULL CHECK(expected_bytes BETWEEN 1 AND 262144),sha256 TEXT NOT NULL CHECK(length(sha256)=64),
 offset_bytes INTEGER NOT NULL DEFAULT 0 CHECK(offset_bytes>=0),allocated_bytes INTEGER NOT NULL CHECK(allocated_bytes>=0),
 state TEXT NOT NULL CHECK(state IN ('RESERVED','SEALED','REFERENCED','ORPHAN','CORRUPT','DISCARDED')),ref_count INTEGER NOT NULL DEFAULT 0 CHECK(ref_count>=0),
 created_at_ms INTEGER NOT NULL,expires_at_ms INTEGER, CHECK(offset_bytes<=expected_bytes)
) STRICT;
CREATE TABLE workflow_budget (singleton INTEGER PRIMARY KEY CHECK(singleton=1), metadata_bytes INTEGER NOT NULL DEFAULT 0 CHECK(metadata_bytes>=0));
INSERT INTO workflow_budget(singleton) VALUES(1);
CREATE TRIGGER workflow_uuid_guard BEFORE INSERT ON workflow_operations
WHEN EXISTS(SELECT 1 FROM request_catalog WHERE request_id=NEW.request_id) OR EXISTS(SELECT 1 FROM discovery_operations WHERE request_id=NEW.request_id)
BEGIN SELECT RAISE(ABORT,'IDEMPOTENCY_CONFLICT'); END;
CREATE TRIGGER catalog_workflow_uuid_guard BEFORE INSERT ON request_catalog WHEN EXISTS(SELECT 1 FROM workflow_operations WHERE request_id=NEW.request_id)
BEGIN SELECT RAISE(ABORT,'IDEMPOTENCY_CONFLICT'); END;
CREATE TRIGGER discovery_workflow_uuid_guard BEFORE INSERT ON discovery_operations WHEN EXISTS(SELECT 1 FROM workflow_operations WHERE request_id=NEW.request_id)
BEGIN SELECT RAISE(ABORT,'IDEMPOTENCY_CONFLICT'); END;
CREATE TRIGGER workflow_intent_immutable BEFORE UPDATE ON workflow_operations
WHEN OLD.request_id<>NEW.request_id OR OLD.canonical_intent<>NEW.canonical_intent OR OLD.payload_hash<>NEW.payload_hash OR OLD.namespace<>NEW.namespace OR OLD.action<>NEW.action OR OLD.owner_uid<>NEW.owner_uid OR OLD.owning_instance_id<>NEW.owning_instance_id
BEGIN SELECT RAISE(ABORT,'INVALID_TRANSITION'); END;
CREATE TRIGGER workflow_terminal_immutable BEFORE UPDATE ON workflow_operations WHEN OLD.phase='FINALIZED' BEGIN SELECT RAISE(ABORT,'INVALID_TRANSITION'); END;
CREATE TRIGGER workflow_grant_immutable BEFORE UPDATE ON workflow_grants WHEN OLD.canonical_intent<>NEW.canonical_intent OR OLD.created_at_ms<>NEW.created_at_ms OR OLD.expires_at_ms<>NEW.expires_at_ms OR OLD.consumed_by_request_id IS NOT NULL BEGIN SELECT RAISE(ABORT,'INVALID_TRANSITION'); END;
CREATE TRIGGER workflow_operations_retained BEFORE DELETE ON workflow_operations BEGIN SELECT RAISE(ABORT,'INVALID_TRANSITION'); END;
`;
