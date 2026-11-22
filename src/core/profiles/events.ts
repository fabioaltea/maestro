import type {EventDraft} from '../../protocol/messages.js';
import type {WorkflowOperationRecord} from '../../ports/workflow.js';
import type {WorkflowIntent} from '../../domain/workflow/authorization.js';
import type {ProfileRecord} from '../../ports/profile.js';

export function profileEvents(operation:WorkflowOperationRecord,instanceId:string,record:ProfileRecord|null):EventDraft[]{
 const {projectId}=JSON.parse(operation.canonicalIntent) as WorkflowIntent;
 const payload={scope:'profile',entityId:operation.targetId,action:operation.action,phase:operation.phase,outcome:operation.outcome,
   ...(projectId?{projectId}:{}),...(record?{state:record.state,stateRevision:record.stateRevision,revisionId:record.revisionId}:{}),
   ...(operation.error?{code:operation.error}:{})};
 const base={instanceId,operationId:operation.requestId,payload};
 return[{...base,type:operation.outcome==='SUCCEEDED'?'operation.completed':'operation.failed'},{...base,type:'profile.changed'}];
}
