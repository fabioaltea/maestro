import {WORKFLOW_SCHEMA_SQL} from './workflow-schema.js';

export const WORKSPACE_SCHEMA_VERSION=6;
export const WORKSPACE_TABLES=['workspaces_records','workspaces_effects','workspaces_leases'] as const;

export const WORKSPACES_SCHEMA_SQL=`
CREATE TABLE workspaces_records (
 workspace_id TEXT PRIMARY KEY CHECK(length(workspace_id)=36),
 feature_id TEXT NOT NULL REFERENCES features_records(feature_id),
 project_id TEXT NOT NULL REFERENCES projects(project_id),
 envelope_id TEXT NOT NULL REFERENCES features_envelopes(envelope_id),
 repository_key TEXT NOT NULL CHECK(length(repository_key) BETWEEN 1 AND 256),
 state TEXT NOT NULL CHECK(state IN ('REQUESTED','CREATING','READY','IN_USE','BLOCKED','RECONCILING','REMOVING','REMOVED')),
 state_revision INTEGER NOT NULL CHECK(state_revision>0),
 owner_generation TEXT NOT NULL CHECK(length(owner_generation)=36),
 target TEXT NOT NULL CHECK(json_valid(target) AND length(CAST(target AS BLOB))<=65536),
 ownership TEXT CHECK(ownership IS NULL OR (json_valid(ownership) AND length(CAST(ownership AS BLOB))<=65536)),
 marker_digest TEXT CHECK(marker_digest IS NULL OR length(marker_digest)=64),
 observation TEXT CHECK(observation IS NULL OR (json_valid(observation) AND length(CAST(observation AS BLOB))<=4096)),
 safe_error TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
 CHECK((ownership IS NULL)=(marker_digest IS NULL))
) STRICT;
CREATE INDEX workspaces_by_project ON workspaces_records(project_id,created_at,workspace_id);
CREATE TABLE workspaces_effects (
 request_id TEXT PRIMARY KEY REFERENCES workflow_operations(request_id),
 workspace_id TEXT NOT NULL REFERENCES workspaces_records(workspace_id) DEFERRABLE INITIALLY DEFERRED,
 repository_key TEXT NOT NULL,
 owner_generation TEXT NOT NULL CHECK(length(owner_generation)=36),
 phase TEXT NOT NULL CHECK(phase IN ('INTENT','BRANCH_INTENT','BRANCH_CREATED','WORKTREE_ADDED','WORKTREE_REMOVED','UNKNOWN','RESOLVED')),
 claim_settled INTEGER NOT NULL DEFAULT 0 CHECK(claim_settled IN (0,1) AND (claim_settled=0 OR phase='RESOLVED')),
 evidence TEXT CHECK(evidence IS NULL OR (json_valid(evidence) AND length(CAST(evidence AS BLOB))<=65536))
) STRICT;
CREATE UNIQUE INDEX workspace_repository_writer ON workspaces_effects(repository_key) WHERE phase<>'RESOLVED';
CREATE TABLE workspaces_leases (
 lease_id TEXT PRIMARY KEY CHECK(length(lease_id)=36),
 workspace_id TEXT NOT NULL REFERENCES workspaces_records(workspace_id),
 holder_type TEXT NOT NULL CHECK(holder_type IN ('ENVIRONMENT','RUN','INTEGRATION')),
 holder_id TEXT NOT NULL CHECK(length(holder_id)=36),
 generation TEXT NOT NULL CHECK(length(generation)=36),
 instance_id TEXT NOT NULL REFERENCES instances(instance_id),
 created_at TEXT NOT NULL,released_at TEXT,release_proof TEXT CHECK(release_proof IS NULL OR json_valid(release_proof)),
 CHECK((released_at IS NULL)=(release_proof IS NULL))
) STRICT;
CREATE UNIQUE INDEX workspace_writer ON workspaces_leases(workspace_id) WHERE released_at IS NULL;
CREATE UNIQUE INDEX workspace_holder_generation ON workspaces_leases(workspace_id,holder_type,holder_id,generation);
CREATE TRIGGER workspace_identity_immutable BEFORE UPDATE ON workspaces_records
WHEN OLD.workspace_id<>NEW.workspace_id OR OLD.feature_id<>NEW.feature_id OR OLD.project_id<>NEW.project_id OR OLD.envelope_id<>NEW.envelope_id
 OR OLD.repository_key<>NEW.repository_key OR OLD.target<>NEW.target OR OLD.created_at<>NEW.created_at
BEGIN SELECT RAISE(ABORT,'INVALID_TRANSITION'); END;
CREATE TRIGGER workspace_retained BEFORE DELETE ON workspaces_records
BEGIN SELECT RAISE(ABORT,'INVALID_TRANSITION'); END;
`;

/** The frozen schema 5 text stays available for the previous migration. */
export const WORKFLOW_SCHEMA_V6_SQL=WORKFLOW_SCHEMA_SQL.replace("namespace IN ('FEATURE','ARTIFACT')","namespace IN ('FEATURE','ARTIFACT','WORKSPACE')");
const statements=WORKFLOW_SCHEMA_V6_SQL.trim().split(/\n(?=CREATE |INSERT )/);
export const WORKFLOW_OPERATIONS_V6_TABLE=statements.find(statement=>statement.startsWith('CREATE TABLE workflow_operations ('))!;
export const WORKFLOW_OPERATIONS_V6_INDEXES_AND_TRIGGERS=statements.filter(statement=>
 /^CREATE (?:INDEX workflow_pending |TRIGGER (?:workflow_uuid_guard |catalog_workflow_uuid_guard |discovery_workflow_uuid_guard |workflow_intent_immutable |workflow_terminal_immutable |workflow_operations_retained ))/.test(statement)).join('\n');
