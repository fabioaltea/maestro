import {WORKFLOW_SCHEMA_V9_SQL,WORKFLOW_OPERATIONS_V9_TABLE,WORKFLOW_OPERATIONS_V9_INDEXES_AND_TRIGGERS} from './execution-schema.js';

export const SCHEDULER_SCHEMA_VERSION=10;
const addScheduler=(sql:string)=>sql.replace("'PROFILE','EXECUTION')","'PROFILE','EXECUTION','SCHEDULER')");
export const WORKFLOW_SCHEMA_V10_SQL=addScheduler(WORKFLOW_SCHEMA_V9_SQL);
export const WORKFLOW_OPERATIONS_V10_TABLE=addScheduler(WORKFLOW_OPERATIONS_V9_TABLE);
export const WORKFLOW_OPERATIONS_V10_INDEXES_AND_TRIGGERS=WORKFLOW_OPERATIONS_V9_INDEXES_AND_TRIGGERS;

export const SCHEDULER_TABLES=['scheduler_policy','scheduler_jobs','scheduler_reservations','scheduler_waits','scheduler_provider_policies','scheduler_switches'] as const;
export const SCHEDULER_SCHEMA_SQL=`
CREATE TABLE scheduler_policy (
 revision INTEGER PRIMARY KEY CHECK(revision>0), request_id TEXT UNIQUE REFERENCES workflow_operations(request_id),
 global_limit INTEGER NOT NULL CHECK(global_limit BETWEEN 1 AND 4),
 install_limit INTEGER NOT NULL CHECK(install_limit BETWEEN 1 AND 2),
 validate_limit INTEGER NOT NULL CHECK(validate_limit BETWEEN 1 AND 2)
) STRICT;
INSERT INTO scheduler_policy VALUES(1,NULL,4,2,2);
CREATE TABLE scheduler_jobs (
 job_id TEXT PRIMARY KEY REFERENCES workflow_operations(request_id),
 intent_id TEXT NOT NULL REFERENCES workflow_grants(grant_id),
 project_id TEXT NOT NULL REFERENCES projects(project_id),
 workspace_id TEXT REFERENCES workspaces_records(workspace_id),
 session_id TEXT REFERENCES execution_sessions(session_id),
 type TEXT NOT NULL CHECK(type IN ('DISCOVERY','EXECUTION','INSTALL','VALIDATE')),
 priority INTEGER NOT NULL CHECK(priority BETWEEN 0 AND 2), queued_at TEXT NOT NULL, not_before TEXT,
 state TEXT NOT NULL CHECK(state IN ('QUEUED','RESERVED','RUNNING','WAITING_RESOURCE','WAITING_PROVIDER','WAITING_USER','PAUSED',
 'CANCELLING','CANCELLED','SUCCEEDED','FAILED','RECONCILING')),
 state_revision INTEGER NOT NULL CHECK(state_revision>0), reason TEXT,
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3)
) STRICT;
CREATE INDEX scheduler_job_history ON scheduler_jobs(project_id,queued_at,job_id);
CREATE UNIQUE INDEX scheduler_pending_intent ON scheduler_jobs(intent_id) WHERE state NOT IN ('CANCELLED','SUCCEEDED','FAILED');
CREATE TABLE scheduler_reservations (
 generation TEXT PRIMARY KEY CHECK(length(generation)=36), job_id TEXT NOT NULL REFERENCES scheduler_jobs(job_id),
 workspace_id TEXT REFERENCES workspaces_records(workspace_id), instance_id TEXT NOT NULL REFERENCES instances(instance_id),
 state TEXT NOT NULL CHECK(state IN ('RESERVED','RUNNING','RECONCILING','RELEASED')),
 go_authorized INTEGER NOT NULL CHECK(go_authorized IN (0,1)),
 proof TEXT CHECK(proof IS NULL OR (json_valid(proof) AND length(CAST(proof AS BLOB))<=4096)),
 CHECK((state='RELEASED')=(proof IS NOT NULL))
) STRICT;
CREATE UNIQUE INDEX scheduler_job_debit ON scheduler_reservations(job_id) WHERE state<>'RELEASED';
CREATE UNIQUE INDEX scheduler_workspace_debit ON scheduler_reservations(workspace_id) WHERE state<>'RELEASED' AND workspace_id IS NOT NULL;
CREATE TABLE scheduler_waits (
 session_id TEXT PRIMARY KEY REFERENCES execution_sessions(session_id), revision INTEGER NOT NULL CHECK(revision>0),
 observation TEXT NOT NULL CHECK(json_valid(observation) AND length(CAST(observation AS BLOB))<=4096)
) STRICT;
CREATE TABLE scheduler_provider_policies (
 policy_id TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0),
 request_id TEXT UNIQUE NOT NULL REFERENCES workflow_operations(request_id), project_id TEXT REFERENCES projects(project_id),
 document TEXT NOT NULL CHECK(json_valid(document) AND length(CAST(document AS BLOB))<=8192),
 revoked_at TEXT, PRIMARY KEY(policy_id,revision)
) STRICT;
CREATE TABLE scheduler_switches (
 decision_id TEXT PRIMARY KEY REFERENCES workflow_operations(request_id), session_id TEXT NOT NULL REFERENCES execution_sessions(session_id),
 checkpoint_id TEXT NOT NULL REFERENCES execution_checkpoints(checkpoint_id), policy_id TEXT NOT NULL, policy_revision INTEGER NOT NULL,
 digest TEXT NOT NULL CHECK(length(digest)=64), outcome TEXT NOT NULL CHECK(outcome IN ('ACCEPTED','BLOCKED','UNKNOWN','STARTED')),
 FOREIGN KEY(policy_id,policy_revision) REFERENCES scheduler_provider_policies(policy_id,revision)
) STRICT;
CREATE TRIGGER scheduler_policy_immutable BEFORE UPDATE ON scheduler_policy
BEGIN SELECT RAISE(ABORT,'INVALID_TRANSITION'); END;
CREATE TRIGGER scheduler_provider_policy_immutable BEFORE UPDATE ON scheduler_provider_policies
BEGIN SELECT RAISE(ABORT,'INVALID_TRANSITION'); END;
CREATE TRIGGER scheduler_job_terminal BEFORE UPDATE ON scheduler_jobs WHEN OLD.state IN ('CANCELLED','SUCCEEDED','FAILED')
BEGIN SELECT RAISE(ABORT,'INVALID_TRANSITION'); END;
CREATE TRIGGER scheduler_reservation_released BEFORE UPDATE ON scheduler_reservations WHEN OLD.state='RELEASED'
BEGIN SELECT RAISE(ABORT,'INVALID_TRANSITION'); END;
`;
