export const FEATURES_SCHEMA_SQL=`
CREATE TABLE features_records (
 feature_id TEXT PRIMARY KEY CHECK(length(feature_id)=36),project_id TEXT NOT NULL REFERENCES projects(project_id),title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 120),
 state TEXT NOT NULL CHECK(state IN ('DRAFT','PLANNING','WAITING_USER','READY_FOR_APPROVAL','APPROVED','NEEDS_REVIEW','ARCHIVED','INTERRUPTED','RECONCILING')),
 state_revision INTEGER NOT NULL CHECK(state_revision>0),current_revision_id TEXT REFERENCES features_revisions(revision_id) DEFERRABLE INITIALLY DEFERRED,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,archived_at TEXT
) STRICT;
CREATE INDEX features_by_project ON features_records(project_id,created_at,feature_id);
CREATE TABLE features_revisions (
 revision_id TEXT PRIMARY KEY CHECK(length(revision_id)=36),feature_id TEXT NOT NULL REFERENCES features_records(feature_id) DEFERRABLE INITIALLY DEFERRED,
 revision_number INTEGER NOT NULL CHECK(revision_number BETWEEN 1 AND 50),parent_revision_id TEXT REFERENCES features_revisions(revision_id),
 artifact_id TEXT NOT NULL REFERENCES workflow_artifacts(artifact_id),bundle_digest TEXT NOT NULL CHECK(length(bundle_digest)=64),
 discovery_approval_id TEXT NOT NULL REFERENCES discovery_approvals(approval_id),discovery_revision_id TEXT NOT NULL REFERENCES discovery_revisions(revision_id),
 context_digest TEXT NOT NULL CHECK(length(context_digest)=64),config_revision INTEGER NOT NULL CHECK(config_revision>0),created_at TEXT NOT NULL,UNIQUE(feature_id,revision_number)
) STRICT;
CREATE TABLE features_approvals (
 approval_id TEXT PRIMARY KEY CHECK(length(approval_id)=36),request_id TEXT NOT NULL UNIQUE REFERENCES workflow_operations(request_id),feature_id TEXT NOT NULL REFERENCES features_records(feature_id),
 revision_id TEXT NOT NULL REFERENCES features_revisions(revision_id),bundle_digest TEXT NOT NULL CHECK(length(bundle_digest)=64),discovery_approval_id TEXT NOT NULL REFERENCES discovery_approvals(approval_id),
 context_digest TEXT NOT NULL CHECK(length(context_digest)=64),config_revision INTEGER NOT NULL CHECK(config_revision>0),accepted_unknown_ids TEXT NOT NULL CHECK(json_valid(accepted_unknown_ids)),owner_uid INTEGER NOT NULL,approved_at TEXT NOT NULL
) STRICT;
CREATE TABLE features_envelopes (
 envelope_id TEXT PRIMARY KEY CHECK(length(envelope_id)=36),feature_id TEXT NOT NULL REFERENCES features_records(feature_id),revision_id TEXT NOT NULL REFERENCES features_revisions(revision_id),
 approval_id TEXT NOT NULL REFERENCES features_approvals(approval_id),project_id TEXT NOT NULL REFERENCES projects(project_id),config_revision INTEGER NOT NULL,
 discovery_approval_id TEXT NOT NULL REFERENCES discovery_approvals(approval_id),context_digest TEXT NOT NULL,bundle_digest TEXT NOT NULL,digest TEXT NOT NULL CHECK(length(digest)=64),created_at TEXT NOT NULL
) STRICT;
CREATE TABLE features_turns (
 turn_id TEXT PRIMARY KEY CHECK(length(turn_id)=36),feature_id TEXT NOT NULL REFERENCES features_records(feature_id),run_id TEXT NOT NULL UNIQUE,generation TEXT NOT NULL UNIQUE,
 request_id TEXT NOT NULL UNIQUE REFERENCES workflow_operations(request_id),expected_revision INTEGER NOT NULL,turn_index INTEGER NOT NULL CHECK(turn_index BETWEEN 1 AND 20),
 phase TEXT NOT NULL CHECK(phase IN ('ACCEPTED','RUNNING','WAITING_USER','SUCCEEDED','FAILED','INTERRUPTED','RECONCILING','CANCELLED')),
 metadata TEXT NOT NULL CHECK(json_valid(metadata) AND length(CAST(metadata AS BLOB))<=16384),UNIQUE(feature_id,turn_index)
) STRICT;
CREATE TRIGGER features_revision_immutable BEFORE UPDATE ON features_revisions BEGIN SELECT RAISE(ABORT,'INVALID_TRANSITION'); END;
CREATE TRIGGER features_approval_immutable BEFORE UPDATE ON features_approvals BEGIN SELECT RAISE(ABORT,'INVALID_TRANSITION'); END;
CREATE TRIGGER features_envelope_immutable BEFORE UPDATE ON features_envelopes BEGIN SELECT RAISE(ABORT,'INVALID_TRANSITION'); END;
CREATE TRIGGER features_identity_immutable BEFORE UPDATE ON features_records WHEN NEW.feature_id<>OLD.feature_id OR NEW.project_id<>OLD.project_id OR NEW.created_at<>OLD.created_at BEGIN SELECT RAISE(ABORT,'INVALID_TRANSITION'); END;
CREATE TRIGGER features_current_revision BEFORE UPDATE OF current_revision_id ON features_records
WHEN NEW.current_revision_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM features_revisions WHERE revision_id=NEW.current_revision_id AND feature_id=NEW.feature_id)
BEGIN SELECT RAISE(ABORT,'INVALID_TRANSITION'); END;
CREATE TRIGGER features_retained BEFORE DELETE ON features_records BEGIN SELECT RAISE(ABORT,'INVALID_TRANSITION'); END;
CREATE TRIGGER features_revision_retained BEFORE DELETE ON features_revisions BEGIN SELECT RAISE(ABORT,'INVALID_TRANSITION'); END;
CREATE TRIGGER features_approval_retained BEFORE DELETE ON features_approvals BEGIN SELECT RAISE(ABORT,'INVALID_TRANSITION'); END;
`;
