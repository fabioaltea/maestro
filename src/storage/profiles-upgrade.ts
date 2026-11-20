import {ENVIRONMENT_TABLES} from './environments-schema.js';
import {upgradeEnvironments} from './environments-upgrade.js';
import {defineNamespaceUpgrade} from './namespace-upgrade.js';
import {PROFILE_SCHEMA_VERSION,PROFILE_TABLES,PROFILES_SCHEMA_SQL,WORKFLOW_OPERATIONS_V8_TABLE,WORKFLOW_OPERATIONS_V8_INDEXES_AND_TRIGGERS} from './profiles-schema.js';

export const {needs:needsProfilesUpgrade,upgrade:upgradeProfiles}=defineNamespaceUpgrade({
 name:'profiles',version:PROFILE_SCHEMA_VERSION,prerequisiteTables:ENVIRONMENT_TABLES,tables:PROFILE_TABLES,previous:upgradeEnvironments,
 workflowTable:WORKFLOW_OPERATIONS_V8_TABLE,workflowIndexes:WORKFLOW_OPERATIONS_V8_INDEXES_AND_TRIGGERS,schema:PROFILES_SCHEMA_SQL,
});
