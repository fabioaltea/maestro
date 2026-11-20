import {ENVIRONMENT_TABLES} from './environments-schema.js';
import {PROFILE_TABLES} from './profiles-schema.js';
import {upgradeProfiles} from './profiles-upgrade.js';
import {defineNamespaceUpgrade} from './namespace-upgrade.js';
import {EXECUTION_SCHEMA_VERSION,EXECUTION_TABLES,EXECUTION_SCHEMA_SQL,WORKFLOW_OPERATIONS_V9_TABLE,WORKFLOW_OPERATIONS_V9_INDEXES_AND_TRIGGERS} from './execution-schema.js';
export const {needs:needsExecutionUpgrade,upgrade:upgradeExecution}=defineNamespaceUpgrade({
 name:'execution',version:EXECUTION_SCHEMA_VERSION,prerequisiteTables:[...ENVIRONMENT_TABLES,...PROFILE_TABLES],tables:EXECUTION_TABLES,
 previous:upgradeProfiles,workflowTable:WORKFLOW_OPERATIONS_V9_TABLE,workflowIndexes:WORKFLOW_OPERATIONS_V9_INDEXES_AND_TRIGGERS,schema:EXECUTION_SCHEMA_SQL,
});
