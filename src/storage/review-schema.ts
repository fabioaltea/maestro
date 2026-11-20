import {WORKFLOW_SCHEMA_V10_SQL,WORKFLOW_OPERATIONS_V10_TABLE,WORKFLOW_OPERATIONS_V10_INDEXES_AND_TRIGGERS} from './scheduler-schema.js';

export const REVIEW_SCHEMA_VERSION=11;
const addReview=(sql:string)=>sql.replace("'EXECUTION','SCHEDULER')","'EXECUTION','SCHEDULER','REVIEW')");
export const WORKFLOW_SCHEMA_V11_SQL=addReview(WORKFLOW_SCHEMA_V10_SQL);
export const WORKFLOW_OPERATIONS_V11_TABLE=addReview(WORKFLOW_OPERATIONS_V10_TABLE);
export const WORKFLOW_OPERATIONS_V11_INDEXES_AND_TRIGGERS=WORKFLOW_OPERATIONS_V10_INDEXES_AND_TRIGGERS;
export const REVIEW_TABLES=['review_records','review_diff_parts','review_evidence','review_decisions','review_candidates','review_integrations','review_receipts'] as const;
export const REVIEW_SCHEMA_SQL=`
ALTER TABLE workspaces_records ADD COLUMN purpose TEXT NOT NULL DEFAULT 'FEATURE'
  CHECK(purpose IN ('FEATURE','INTEGRATION_GUARD','INTEGRATION_STAGING'));
CREATE TRIGGER workspace_purpose_immutable BEFORE UPDATE OF purpose ON workspaces_records WHEN NEW.purpose<>OLD.purpose
BEGIN SELECT RAISE(ABORT,'INVALID_TRANSITION'); END;
CREATE TABLE review_records (
 review_id TEXT PRIMARY KEY REFERENCES workflow_operations(request_id),
 project_id TEXT NOT NULL REFERENCES projects(project_id),feature_id TEXT NOT NULL REFERENCES features_records(feature_id),
 feature_revision_id TEXT NOT NULL REFERENCES features_revisions(revision_id),workspace_id TEXT NOT NULL REFERENCES workspaces_records(workspace_id),
 checkpoint_id TEXT NOT NULL REFERENCES execution_checkpoints(checkpoint_id),source_oid TEXT NOT NULL,source_tree_oid TEXT NOT NULL,
 target_ref TEXT NOT NULL,target_oid TEXT NOT NULL,digest TEXT NOT NULL CHECK(length(digest)=64),
 state TEXT NOT NULL CHECK(state IN ('DRAFT','CHECKING','CHANGES_REQUESTED','READY_FOR_APPROVAL','BLOCKED','STALE','APPROVED')),
 state_revision INTEGER NOT NULL CHECK(state_revision>0),created_at TEXT NOT NULL,
 file_count INTEGER NOT NULL CHECK(file_count BETWEEN 0 AND 100),diff_bytes INTEGER NOT NULL CHECK(diff_bytes BETWEEN 0 AND 2097152)
) STRICT;
CREATE INDEX review_history ON review_records(project_id,created_at,review_id);
CREATE TABLE review_diff_parts (
 review_id TEXT NOT NULL REFERENCES review_records(review_id), ordinal INTEGER NOT NULL CHECK(ordinal BETWEEN 0 AND 7),
 artifact_id TEXT NOT NULL UNIQUE REFERENCES workflow_artifacts(artifact_id), sha256 TEXT NOT NULL CHECK(length(sha256)=64),
 bytes INTEGER NOT NULL CHECK(bytes BETWEEN 1 AND 262144), PRIMARY KEY(review_id,ordinal)
) STRICT;
CREATE TABLE review_evidence (
 evidence_id TEXT PRIMARY KEY CHECK(length(evidence_id)=36), review_id TEXT NOT NULL REFERENCES review_records(review_id),
 criterion_id TEXT NOT NULL, job_id TEXT REFERENCES environments_jobs(job_id), input_tree_oid TEXT NOT NULL,
 command_digest TEXT NOT NULL CHECK(length(command_digest)=64), status TEXT NOT NULL CHECK(status IN ('PASS','FAIL','NOT_RUN','BLOCKED')),
 output_id TEXT REFERENCES workflow_artifacts(artifact_id), checked_at TEXT NOT NULL, CHECK(status<>'PASS' OR job_id IS NOT NULL)
) STRICT;
CREATE TABLE review_candidates (
 candidate_id TEXT PRIMARY KEY REFERENCES workflow_operations(request_id),review_id TEXT NOT NULL REFERENCES review_records(review_id),
 source_oid TEXT NOT NULL,old_target_oid TEXT NOT NULL,candidate_oid TEXT NOT NULL,tree_oid TEXT NOT NULL,
 guard_id TEXT NOT NULL REFERENCES workspaces_records(workspace_id),staging_id TEXT NOT NULL REFERENCES workspaces_records(workspace_id),
 digest TEXT NOT NULL CHECK(length(digest)=64)
) STRICT;
CREATE TABLE review_decisions (
 decision_id TEXT PRIMARY KEY REFERENCES workflow_operations(request_id),review_id TEXT NOT NULL REFERENCES review_records(review_id),
 candidate_id TEXT REFERENCES review_candidates(candidate_id),review_digest TEXT NOT NULL CHECK(length(review_digest)=64),
 kind TEXT NOT NULL CHECK(kind IN ('REQUEST_CHANGES','APPROVE_INTEGRATION')),feedback_artifact_id TEXT REFERENCES workflow_artifacts(artifact_id),
 created_at TEXT NOT NULL,CHECK((kind='REQUEST_CHANGES')=(feedback_artifact_id IS NOT NULL)),
 CHECK((kind='APPROVE_INTEGRATION')=(candidate_id IS NOT NULL))
) STRICT;
CREATE TABLE review_integrations (
 integration_id TEXT PRIMARY KEY REFERENCES workflow_operations(request_id),
 candidate_id TEXT NOT NULL REFERENCES review_candidates(candidate_id),decision_id TEXT NOT NULL REFERENCES review_decisions(decision_id),
 repository_key TEXT NOT NULL,target_ref TEXT NOT NULL,expected_target_oid TEXT NOT NULL,
 phase TEXT NOT NULL CHECK(phase IN ('REF_INTENT','REF_UPDATED','GUARD_SYNCED','FINALIZED','RECONCILING')),
 resulting_oid TEXT,proof TEXT CHECK(proof IS NULL OR (json_valid(proof) AND length(CAST(proof AS BLOB))<=8192))
) STRICT;
CREATE UNIQUE INDEX review_repository_reservation ON review_integrations(repository_key) WHERE phase<>'FINALIZED';
CREATE TABLE review_receipts (
 receipt_id TEXT PRIMARY KEY REFERENCES workflow_operations(request_id), integration_id TEXT NOT NULL UNIQUE REFERENCES review_integrations(integration_id),
 metadata TEXT NOT NULL CHECK(json_valid(metadata) AND length(CAST(metadata AS BLOB))<=8192)
) STRICT;
CREATE TRIGGER review_snapshot_immutable BEFORE UPDATE OF review_id,project_id,feature_id,feature_revision_id,workspace_id,checkpoint_id,
 source_oid,source_tree_oid,target_ref,target_oid,digest,created_at,file_count,diff_bytes ON review_records
BEGIN SELECT RAISE(ABORT,'INVALID_TRANSITION'); END;
CREATE TRIGGER review_revision_step BEFORE UPDATE OF state_revision ON review_records WHEN NEW.state_revision<>OLD.state_revision+1
BEGIN SELECT RAISE(ABORT,'INVALID_TRANSITION'); END;
CREATE TRIGGER review_diff_immutable BEFORE UPDATE ON review_diff_parts
BEGIN SELECT RAISE(ABORT,'INVALID_TRANSITION'); END;
CREATE TRIGGER review_decision_immutable BEFORE UPDATE ON review_decisions
BEGIN SELECT RAISE(ABORT,'INVALID_TRANSITION'); END;
CREATE TRIGGER review_candidate_immutable BEFORE UPDATE ON review_candidates
BEGIN SELECT RAISE(ABORT,'INVALID_TRANSITION'); END;
CREATE TRIGGER review_receipt_immutable BEFORE UPDATE ON review_receipts
BEGIN SELECT RAISE(ABORT,'INVALID_TRANSITION'); END;
`;
