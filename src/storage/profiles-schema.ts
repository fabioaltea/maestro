import {WORKFLOW_SCHEMA_V7_SQL,WORKFLOW_OPERATIONS_V7_TABLE,WORKFLOW_OPERATIONS_V7_INDEXES_AND_TRIGGERS} from './environments-schema.js';

export const PROFILE_SCHEMA_VERSION=8;
const addProfile=(sql:string)=>sql.replace("'WORKSPACE','ENVIRONMENT')","'WORKSPACE','ENVIRONMENT','PROFILE')");
export const WORKFLOW_SCHEMA_V8_SQL=addProfile(WORKFLOW_SCHEMA_V7_SQL);
export const WORKFLOW_OPERATIONS_V8_TABLE=addProfile(WORKFLOW_OPERATIONS_V7_TABLE);
export const WORKFLOW_OPERATIONS_V8_INDEXES_AND_TRIGGERS=WORKFLOW_OPERATIONS_V7_INDEXES_AND_TRIGGERS;
export const PROFILE_TABLES=['profiles_records','profiles_revisions','profiles_resolutions','profiles_previews'] as const;

export const PROFILES_SCHEMA_SQL=`
CREATE TABLE profiles_records (
 entity_id TEXT PRIMARY KEY CHECK(length(entity_id)=36), kind TEXT NOT NULL CHECK(kind IN ('PROFILE','SKILL','TOOL')),
 scope TEXT NOT NULL CHECK(scope IN ('GLOBAL','PROJECT','PROFILE')), project_id TEXT REFERENCES projects(project_id),
 owner_profile_id TEXT REFERENCES profiles_records(entity_id), alias TEXT NOT NULL CHECK(length(alias) BETWEEN 1 AND 64),
 state TEXT NOT NULL CHECK(state IN ('DRAFT','REVIEWED','ENABLED','DISABLED')),
 state_revision INTEGER NOT NULL CHECK(state_revision>0), revision_id TEXT REFERENCES profiles_revisions(revision_id) DEFERRABLE INITIALLY DEFERRED,
 updated_at TEXT NOT NULL,
 CHECK((scope='GLOBAL' AND project_id IS NULL AND owner_profile_id IS NULL) OR
       (scope='PROJECT' AND project_id IS NOT NULL AND owner_profile_id IS NULL) OR
       (scope='PROFILE' AND owner_profile_id IS NOT NULL AND kind='SKILL'))
) STRICT;
CREATE UNIQUE INDEX profiles_unique_alias ON profiles_records(kind,scope,coalesce(project_id,''),coalesce(owner_profile_id,''),alias);
CREATE INDEX profiles_catalog ON profiles_records(kind,project_id,entity_id);
CREATE TABLE profiles_revisions (
 revision_id TEXT PRIMARY KEY CHECK(length(revision_id)=36), entity_id TEXT NOT NULL REFERENCES profiles_records(entity_id) DEFERRABLE INITIALLY DEFERRED,
 previous_id TEXT REFERENCES profiles_revisions(revision_id), digest TEXT NOT NULL CHECK(length(digest)=64),
 artifact_id TEXT REFERENCES workflow_artifacts(artifact_id), byte_length INTEGER NOT NULL CHECK(byte_length BETWEEN 0 AND 262144),
 document TEXT NOT NULL CHECK(json_valid(document) AND length(CAST(document AS BLOB))<=32768), created_at TEXT NOT NULL
) STRICT;
CREATE INDEX profiles_history ON profiles_revisions(entity_id,created_at,revision_id);
CREATE TABLE profiles_resolutions (
 resolution_id TEXT PRIMARY KEY REFERENCES workflow_operations(request_id), profile_id TEXT NOT NULL REFERENCES profiles_records(entity_id),
 revision_id TEXT NOT NULL REFERENCES profiles_revisions(revision_id), project_id TEXT NOT NULL REFERENCES projects(project_id),
 project_revision INTEGER NOT NULL CHECK(project_revision>0), capability_digest TEXT NOT NULL CHECK(length(capability_digest)=64),
 digest TEXT NOT NULL CHECK(length(digest)=64), snapshot TEXT NOT NULL CHECK(json_valid(snapshot) AND length(CAST(snapshot AS BLOB))<=32768),
 dependencies TEXT NOT NULL CHECK(json_valid(dependencies) AND length(CAST(dependencies AS BLOB))<=8192), created_at TEXT NOT NULL
) STRICT;
CREATE TABLE profiles_previews (
 preview_id TEXT PRIMARY KEY REFERENCES workflow_operations(request_id), artifact_id TEXT NOT NULL REFERENCES workflow_artifacts(artifact_id),
 evidence TEXT NOT NULL CHECK(json_valid(evidence) AND length(CAST(evidence AS BLOB))<=16384)
) STRICT;
CREATE TRIGGER profile_identity BEFORE UPDATE ON profiles_records WHEN OLD.entity_id<>NEW.entity_id OR OLD.kind<>NEW.kind OR
 OLD.scope<>NEW.scope OR OLD.project_id IS NOT NEW.project_id OR OLD.owner_profile_id IS NOT NEW.owner_profile_id OR OLD.alias<>NEW.alias
BEGIN SELECT RAISE(ABORT,'INVALID_TRANSITION'); END;
CREATE TRIGGER profile_revision_immutable BEFORE UPDATE ON profiles_revisions BEGIN SELECT RAISE(ABORT,'INVALID_TRANSITION'); END;
CREATE TRIGGER profile_resolution_immutable BEFORE UPDATE ON profiles_resolutions BEGIN SELECT RAISE(ABORT,'INVALID_TRANSITION'); END;
CREATE TRIGGER profile_preview_immutable BEFORE UPDATE ON profiles_previews BEGIN SELECT RAISE(ABORT,'INVALID_TRANSITION'); END;
CREATE TRIGGER profile_revision_retained BEFORE DELETE ON profiles_revisions BEGIN SELECT RAISE(ABORT,'INVALID_TRANSITION'); END;
CREATE TRIGGER profile_resolution_retained BEFORE DELETE ON profiles_resolutions BEGIN SELECT RAISE(ABORT,'INVALID_TRANSITION'); END;
`;
