import {WORKFLOW_SCHEMA_V8_SQL,WORKFLOW_OPERATIONS_V8_TABLE,WORKFLOW_OPERATIONS_V8_INDEXES_AND_TRIGGERS} from './profiles-schema.js';
export const EXECUTION_SCHEMA_VERSION=9;
const addExecution=(value:string)=>value.replace("'ENVIRONMENT','PROFILE')","'ENVIRONMENT','PROFILE','EXECUTION')");
export const WORKFLOW_SCHEMA_V9_SQL=addExecution(WORKFLOW_SCHEMA_V8_SQL);
export const WORKFLOW_OPERATIONS_V9_TABLE=addExecution(WORKFLOW_OPERATIONS_V8_TABLE);
export const WORKFLOW_OPERATIONS_V9_INDEXES_AND_TRIGGERS=WORKFLOW_OPERATIONS_V8_INDEXES_AND_TRIGGERS;
export const EXECUTION_TABLES=['execution_providers','execution_sessions','execution_runs','execution_checkpoints','execution_output','execution_interactions'] as const;
export const EXECUTION_SCHEMA_SQL=`
CREATE TABLE execution_providers (
 provider_id TEXT PRIMARY KEY CHECK(provider_id IN ('codex','claude')), config_revision INTEGER NOT NULL CHECK(config_revision>0),
 metadata TEXT NOT NULL CHECK(json_valid(metadata) AND length(CAST(metadata AS BLOB))<=4096)
) STRICT;
CREATE TABLE execution_sessions (
 session_id TEXT PRIMARY KEY REFERENCES workflow_operations(request_id), feature_id TEXT NOT NULL REFERENCES features_records(feature_id),
 workspace_id TEXT NOT NULL REFERENCES workspaces_records(workspace_id), project_id TEXT NOT NULL REFERENCES projects(project_id),
 profile_resolution_id TEXT NOT NULL REFERENCES profiles_resolutions(resolution_id), state TEXT NOT NULL CHECK(state IN ('CREATED','RUNNING','WAITING_USER',
 'PAUSING','PAUSED','CANCELLING','CANCELLED','READY_FOR_REVIEW','FAILED','INTERRUPTED','RECONCILING')), state_revision INTEGER NOT NULL CHECK(state_revision>0),
 run_id TEXT NOT NULL REFERENCES execution_runs(run_id) DEFERRABLE INITIALLY DEFERRED,
 checkpoint_id TEXT REFERENCES execution_checkpoints(checkpoint_id) DEFERRABLE INITIALLY DEFERRED,
 envelope_id TEXT NOT NULL REFERENCES features_envelopes(envelope_id),created_at TEXT NOT NULL,updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX execution_session_history ON execution_sessions(project_id,created_at,session_id);
CREATE TABLE execution_runs (
 run_id TEXT PRIMARY KEY REFERENCES workflow_operations(request_id), session_id TEXT NOT NULL REFERENCES execution_sessions(session_id) DEFERRABLE INITIALLY DEFERRED,
 generation TEXT NOT NULL UNIQUE CHECK(length(generation)=36), instance_id TEXT NOT NULL REFERENCES instances(instance_id),
 provider_id TEXT NOT NULL CHECK(provider_id IN ('codex','claude')), config_revision INTEGER NOT NULL CHECK(config_revision>0),
 capability_digest TEXT NOT NULL CHECK(length(capability_digest)=64), input_digest TEXT NOT NULL CHECK(length(input_digest)=64),
 phase TEXT NOT NULL CHECK(phase IN ('PREPARED','HOST_READY','START_AUTHORIZED','RUNNING','EXIT_OBSERVED','FINALIZED')),
 outcome TEXT NOT NULL CHECK(outcome IN ('IN_PROGRESS','SUCCEEDED','FAILED','INTERRUPTED','UNKNOWN')), lease_id TEXT REFERENCES workspaces_leases(lease_id),
 identity TEXT CHECK(identity IS NULL OR json_valid(identity)), proof TEXT CHECK(proof IS NULL OR json_valid(proof)), requested TEXT CHECK(requested IN ('PAUSE','CANCEL')),
 control_request_id TEXT UNIQUE REFERENCES workflow_operations(request_id), output_watermark INTEGER NOT NULL DEFAULT 0 CHECK(output_watermark>=0),
 truncated INTEGER NOT NULL DEFAULT 0 CHECK(truncated IN (0,1))
) STRICT;
CREATE UNIQUE INDEX execution_active_run ON execution_runs((1)) WHERE phase<>'FINALIZED';
CREATE INDEX execution_runs_by_session ON execution_runs(session_id,run_id);
CREATE TABLE execution_checkpoints (
 checkpoint_id TEXT PRIMARY KEY REFERENCES workflow_operations(request_id), session_id TEXT NOT NULL REFERENCES execution_sessions(session_id),
 run_id TEXT NOT NULL REFERENCES execution_runs(run_id), input_digest TEXT NOT NULL CHECK(length(input_digest)=64),
 tree_digest TEXT NOT NULL CHECK(length(tree_digest)=64), patch_artifact_id TEXT NOT NULL REFERENCES workflow_artifacts(artifact_id),
 digest TEXT NOT NULL CHECK(length(digest)=64), created_at TEXT NOT NULL
) STRICT;
CREATE TABLE execution_output (
 run_id TEXT NOT NULL REFERENCES execution_runs(run_id), seq INTEGER NOT NULL CHECK(seq>0), artifact_id TEXT NOT NULL REFERENCES workflow_artifacts(artifact_id),
 sha256 TEXT NOT NULL CHECK(length(sha256)=64), bytes INTEGER NOT NULL CHECK(bytes BETWEEN 1 AND 8192), PRIMARY KEY(run_id,seq)
) STRICT;
CREATE TABLE execution_interactions (
 interaction_id TEXT PRIMARY KEY CHECK(length(interaction_id)=36), run_id TEXT NOT NULL REFERENCES execution_runs(run_id),
 generation TEXT NOT NULL CHECK(length(generation)=36), expected_revision INTEGER NOT NULL CHECK(expected_revision>0),
 text_artifact_id TEXT NOT NULL REFERENCES workflow_artifacts(artifact_id), type TEXT NOT NULL CHECK(type IN ('QUESTION','TOOL_REQUEST')),
 status TEXT NOT NULL CHECK(status IN ('OPEN','ANSWERED')), answer_artifact_id TEXT REFERENCES workflow_artifacts(artifact_id)
) STRICT;
CREATE UNIQUE INDEX execution_open_interaction ON execution_interactions(run_id) WHERE status='OPEN';
CREATE TRIGGER execution_excludes_discovery BEFORE UPDATE OF discovery_id ON discovery_slot
WHEN NEW.discovery_id IS NOT NULL AND EXISTS(SELECT 1 FROM execution_runs WHERE phase<>'FINALIZED')
BEGIN SELECT RAISE(ABORT,'BUSY'); END;
CREATE TRIGGER execution_excludes_planning_insert BEFORE INSERT ON features_turns
WHEN NEW.phase IN ('ACCEPTED','RUNNING','RECONCILING') AND EXISTS(SELECT 1 FROM execution_runs WHERE phase<>'FINALIZED')
BEGIN SELECT RAISE(ABORT,'BUSY'); END;
CREATE TRIGGER execution_excludes_planning_update BEFORE UPDATE OF phase ON features_turns
WHEN NEW.phase IN ('ACCEPTED','RUNNING','RECONCILING') AND EXISTS(SELECT 1 FROM execution_runs WHERE phase<>'FINALIZED')
BEGIN SELECT RAISE(ABORT,'BUSY'); END;
CREATE TRIGGER execution_terminal_immutable BEFORE UPDATE ON execution_runs WHEN OLD.phase='FINALIZED'
BEGIN SELECT RAISE(ABORT,'INVALID_TRANSITION'); END;
CREATE TRIGGER execution_checkpoint_immutable BEFORE UPDATE ON execution_checkpoints
BEGIN SELECT RAISE(ABORT,'INVALID_TRANSITION'); END;
`;
