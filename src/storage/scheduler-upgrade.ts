import {EXECUTION_TABLES} from './execution-schema.js';
import {upgradeExecution} from './execution-upgrade.js';
import {defineNamespaceUpgrade} from './namespace-upgrade.js';
import {SCHEDULER_SCHEMA_VERSION,SCHEDULER_TABLES,SCHEDULER_SCHEMA_SQL,WORKFLOW_OPERATIONS_V10_TABLE,WORKFLOW_OPERATIONS_V10_INDEXES_AND_TRIGGERS} from './scheduler-schema.js';

export const {needs:needsSchedulerUpgrade,upgrade:upgradeScheduler}=defineNamespaceUpgrade({
 name:'scheduler',version:SCHEDULER_SCHEMA_VERSION,prerequisiteTables:EXECUTION_TABLES,tables:SCHEDULER_TABLES,
 previous:upgradeExecution,workflowTable:WORKFLOW_OPERATIONS_V10_TABLE,workflowIndexes:WORKFLOW_OPERATIONS_V10_INDEXES_AND_TRIGGERS,
 schema:SCHEDULER_SCHEMA_SQL,
});
