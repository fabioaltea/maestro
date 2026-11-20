import type {EventDraft} from '../../protocol/messages.js';
import type {ReviewRecord} from '../../ports/review.js';
import type {WorkflowOperationRecord} from '../../ports/workflow.js';

export function reviewEvents(op:WorkflowOperationRecord,instanceId:string,review:ReviewRecord):EventDraft[]{
 const operationId=op.requestId;
 const identity={scope:'review',reviewId:review.reviewId,featureId:review.featureId,projectId:review.projectId,stateRevision:review.stateRevision};
 const events:EventDraft[]=[{type:'review.changed',instanceId,operationId,payload:{...identity,
   state:review.state,action:op.action,outcome:op.outcome,phase:op.phase}}];
 if(op.action==='create'&&op.outcome==='SUCCEEDED'&&review.parts.length){
   events.push({type:'review.output.available',instanceId,operationId,payload:{...identity,watermark:String(review.parts.length)}});
 }
 return events;
}
