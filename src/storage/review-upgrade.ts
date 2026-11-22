import {SCHEDULER_TABLES} from './scheduler-schema.js';
import {upgradeScheduler} from './scheduler-upgrade.js';
import {defineNamespaceUpgrade} from './namespace-upgrade.js';
import {REVIEW_SCHEMA_VERSION,REVIEW_TABLES,REVIEW_SCHEMA_SQL,WORKFLOW_OPERATIONS_V11_TABLE,WORKFLOW_OPERATIONS_V11_INDEXES_AND_TRIGGERS} from './review-schema.js';

export const {needs:needsReviewUpgrade,upgrade:upgradeReview}=defineNamespaceUpgrade({
 name:'review',version:REVIEW_SCHEMA_VERSION,prerequisiteTables:SCHEDULER_TABLES,tables:REVIEW_TABLES,
 previous:upgradeScheduler,workflowTable:WORKFLOW_OPERATIONS_V11_TABLE,workflowIndexes:WORKFLOW_OPERATIONS_V11_INDEXES_AND_TRIGGERS,
 schema:REVIEW_SCHEMA_SQL,
});
