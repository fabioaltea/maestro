import type {EventDraft} from '../../protocol/messages.js';
import type {ReviewRecord} from '../../ports/review.js';
import type {WorkflowOperationRecord} from '../../ports/workflow.js';

export function reviewChanged(op:WorkflowOperationRecord,instanceId:string,review:ReviewRecord):EventDraft{
 return{type:'review.changed',instanceId,operationId:op.requestId,payload:{scope:'review',reviewId:review.reviewId,
   featureId:review.featureId,projectId:review.projectId,state:review.state,stateRevision:review.stateRevision,
   action:op.action,outcome:op.outcome,phase:op.phase}};
}
