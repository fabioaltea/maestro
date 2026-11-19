import {WORKFLOW_SCHEMA_V6_SQL,WORKFLOW_OPERATIONS_V6_TABLE,WORKFLOW_OPERATIONS_V6_INDEXES_AND_TRIGGERS} from './workspaces-schema.js';

export const ENVIRONMENT_SCHEMA_VERSION=7;
export const ENVIRONMENT_TABLES=['environments_records','environments_plans','environments_attestations','environments_jobs','environments_output'] as const;
const namespace=(sql:string)=>sql.replace("namespace IN ('FEATURE','ARTIFACT','WORKSPACE')","namespace IN ('FEATURE','ARTIFACT','WORKSPACE','ENVIRONMENT')");
export const WORKFLOW_SCHEMA_V7_SQL=namespace(WORKFLOW_SCHEMA_V6_SQL);
export const WORKFLOW_OPERATIONS_V7_TABLE=namespace(WORKFLOW_OPERATIONS_V6_TABLE);
export const WORKFLOW_OPERATIONS_V7_INDEXES_AND_TRIGGERS=WORKFLOW_OPERATIONS_V6_INDEXES_AND_TRIGGERS;

export const ENVIRONMENTS_SCHEMA_SQL=`
CREATE TABLE environments_records (
 environment_id TEXT PRIMARY KEY CHECK(length(environment_id)=36),
 workspace_id TEXT NOT NULL UNIQUE REFERENCES workspaces_records(workspace_id),
 workspace_generation TEXT NOT NULL CHECK(length(workspace_generation)=36),
 state TEXT NOT NULL CHECK(state IN ('UNCONFIGURED','PLANNED','MANUAL_REQUIRED','MANUAL_VERIFIED','PREPARING','READY','STALE','BLOCKED','RECONCILING')),
 state_revision INTEGER NOT NULL CHECK(state_revision>0),
 current_plan_id TEXT REFERENCES environments_plans(plan_id) DEFERRABLE INITIALLY DEFERRED,
 attestation_id TEXT REFERENCES environments_attestations(attestation_id) DEFERRABLE INITIALLY DEFERRED,
 prepared_digest TEXT CHECK(prepared_digest IS NULL OR length(prepared_digest)=64),
 safe_error TEXT,checked_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
 CHECK((state='READY')=(prepared_digest IS NOT NULL)),
 CHECK(state<>'MANUAL_VERIFIED' OR attestation_id IS NOT NULL)
) STRICT;
CREATE TABLE environments_plans (
 plan_id TEXT PRIMARY KEY CHECK(length(plan_id)=36),
 environment_id TEXT NOT NULL REFERENCES environments_records(environment_id) DEFERRABLE INITIALLY DEFERRED,
 request_id TEXT NOT NULL UNIQUE REFERENCES workflow_operations(request_id),
 workspace_generation TEXT NOT NULL CHECK(length(workspace_generation)=36),
 workspace_revision INTEGER NOT NULL CHECK(workspace_revision>0),
 config_revision INTEGER NOT NULL CHECK(config_revision>0),
 digest TEXT NOT NULL CHECK(length(digest)=64),
 input_digest TEXT NOT NULL CHECK(length(input_digest)=64),
 artifact_id TEXT NOT NULL REFERENCES workflow_artifacts(artifact_id),
 metadata TEXT NOT NULL CHECK(json_valid(metadata) AND length(CAST(metadata AS BLOB))<=32768),
 created_at TEXT NOT NULL
) STRICT;
CREATE INDEX environment_plan_history ON environments_plans(environment_id,created_at,plan_id);
CREATE TABLE environments_attestations (
 attestation_id TEXT PRIMARY KEY CHECK(length(attestation_id)=36),
 environment_id TEXT NOT NULL REFERENCES environments_records(environment_id),
 plan_id TEXT NOT NULL REFERENCES environments_plans(plan_id),
 request_id TEXT NOT NULL UNIQUE REFERENCES workflow_operations(request_id),
 input_digest TEXT NOT NULL CHECK(length(input_digest)=64),
 limitations TEXT NOT NULL CHECK(json_valid(limitations) AND length(CAST(limitations AS BLOB))<=4096),
 owner_uid INTEGER NOT NULL CHECK(owner_uid>=0),created_at TEXT NOT NULL
) STRICT;
CREATE TABLE environments_jobs (
 job_id TEXT PRIMARY KEY CHECK(length(job_id)=36),
 environment_id TEXT NOT NULL REFERENCES environments_records(environment_id),
 plan_id TEXT NOT NULL REFERENCES environments_plans(plan_id),
 request_id TEXT NOT NULL UNIQUE REFERENCES workflow_operations(request_id),
 cancel_request_id TEXT UNIQUE REFERENCES workflow_operations(request_id),
 kind TEXT NOT NULL CHECK(kind IN ('INSTALL','VALIDATE')),
 command_spec_id TEXT CHECK(command_spec_id IS NULL OR length(command_spec_id)=36),
 generation TEXT NOT NULL CHECK(length(generation)=36),
 lease_id TEXT REFERENCES workspaces_leases(lease_id),
 phase TEXT NOT NULL CHECK(phase IN ('QUEUED','RUNNING','CANCELLING','SUCCEEDED','FAILED','CANCELLED','RECONCILING')),
 state_revision INTEGER NOT NULL CHECK(state_revision>0),
 input_digest TEXT NOT NULL CHECK(length(input_digest)=64),
 output_watermark INTEGER NOT NULL DEFAULT 0 CHECK(output_watermark>=0),
 truncated INTEGER NOT NULL DEFAULT 0 CHECK(truncated IN (0,1)),
 exit_proof TEXT CHECK(exit_proof IS NULL OR (json_valid(exit_proof) AND length(CAST(exit_proof AS BLOB))<=4096)),
 safe_error TEXT,created_at TEXT NOT NULL,completed_at TEXT
) STRICT;
CREATE UNIQUE INDEX environment_active_job ON environments_jobs((1)) WHERE phase IN ('QUEUED','RUNNING','CANCELLING','RECONCILING');
CREATE INDEX environment_jobs_by_environment ON environments_jobs(environment_id,created_at,job_id);
CREATE TABLE environments_output (
 job_id TEXT NOT NULL REFERENCES environments_jobs(job_id),
 seq INTEGER NOT NULL CHECK(seq>0),
 artifact_id TEXT NOT NULL REFERENCES workflow_artifacts(artifact_id),
 sha256 TEXT NOT NULL CHECK(length(sha256)=64),
 bytes INTEGER NOT NULL CHECK(bytes BETWEEN 1 AND 8192),
 PRIMARY KEY(job_id,seq)
) STRICT;
CREATE TRIGGER environment_record_identity BEFORE UPDATE ON environments_records
WHEN OLD.environment_id<>NEW.environment_id OR OLD.workspace_id<>NEW.workspace_id OR OLD.created_at<>NEW.created_at
BEGIN SELECT RAISE(ABORT,'INVALID_TRANSITION'); END;
CREATE TRIGGER environment_plan_immutable BEFORE UPDATE ON environments_plans BEGIN SELECT RAISE(ABORT,'INVALID_TRANSITION'); END;
CREATE TRIGGER environment_attestation_immutable BEFORE UPDATE ON environments_attestations BEGIN SELECT RAISE(ABORT,'INVALID_TRANSITION'); END;
CREATE TRIGGER environment_plan_retained BEFORE DELETE ON environments_plans BEGIN SELECT RAISE(ABORT,'INVALID_TRANSITION'); END;
CREATE TRIGGER environment_attestation_retained BEFORE DELETE ON environments_attestations BEGIN SELECT RAISE(ABORT,'INVALID_TRANSITION'); END;
`;
