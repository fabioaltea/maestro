import type {EventDraft} from '../../protocol/messages.js';
import type {SchedulerJob} from '../../ports/scheduler.js';
import type {WorkflowOperationRecord} from '../../ports/workflow.js';

export function schedulerChanged(op:WorkflowOperationRecord,instanceId:string,job:SchedulerJob|null):EventDraft{
 return{type:'scheduler.changed',instanceId,operationId:op.requestId,payload:{scope:'scheduler',action:op.action,phase:op.phase,outcome:op.outcome,
   ...(job?{jobId:job.jobId,projectId:job.projectId,state:job.state,stateRevision:job.stateRevision,...(job.reason?{code:job.reason}:{})}:{}),
   ...(typeof op.result?.policyRevision==='string'?{stateRevision:op.result.policyRevision}:{})}};
}
