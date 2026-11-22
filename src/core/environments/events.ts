import type {EventDraft} from '../../protocol/messages.js';
import type {WorkflowOperationRecord} from '../../ports/workflow.js';
import type {EnvironmentJob,EnvironmentRecord} from '../../ports/environment.js';
import type {WorkflowIntent} from '../../domain/workflow/authorization.js';

export function environmentEventDrafts(operation:WorkflowOperationRecord,instanceId:string,environment?:EnvironmentRecord|null):EventDraft[]{
 const intent=JSON.parse(operation.canonicalIntent) as WorkflowIntent;
 const workspaceId=operation.targetId;
 if(!workspaceId)throw new Error('INVALID_REQUEST');
 const payload={scope:'environment',workspaceId,...(intent.projectId?{projectId:intent.projectId}:{}),
   ...(environment?{environmentId:environment.environmentId,state:environment.state,stateRevision:environment.stateRevision}:{}),
   ...(typeof operation.result?.planId==='string'?{planId:operation.result.planId}:{}),
   ...(typeof operation.result?.jobId==='string'?{jobId:operation.result.jobId}:{}),
   action:operation.action,outcome:operation.outcome,phase:operation.phase,...(operation.error?{code:operation.error}:{})};
 const base={instanceId,operationId:operation.requestId,payload};
 const event:EventDraft['type']=operation.phase==='ACCEPTED'?'operation.accepted':operation.outcome==='SUCCEEDED'?'operation.completed':
   operation.outcome==='UNKNOWN'||operation.outcome==='BLOCKED'?'operation.blocked':'operation.failed';
 return [...(operation.phase==='WORKING'&&operation.outcome==='IN_PROGRESS'?[]:[{...base,type:event}]),{...base,type:'environment.changed'}];
}

export function environmentOutputEvent(job:EnvironmentJob,workspaceId:string,instanceId:string):EventDraft{
 return{type:'environment.output.available',instanceId,operationId:job.requestId,payload:{scope:'environment',workspaceId,
   jobId:job.jobId,environmentId:job.environmentId,planId:job.planId,watermark:job.outputWatermark,truncated:job.truncated}};
}
