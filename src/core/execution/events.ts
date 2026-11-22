import type {EventDraft} from '../../protocol/messages.js';
import type {ExecutionRun,ExecutionSession} from '../../ports/execution.js';
import type {WorkflowOperationRecord} from '../../ports/workflow.js';

export function executionEvents(op:WorkflowOperationRecord,instanceId:string,session:ExecutionSession,run:ExecutionRun,output:boolean):EventDraft[]{
 const identifiers={scope:'execution',sessionId:session.sessionId,runId:run.runId,workspaceId:session.workspaceId};
 if(output)return[{type:'execution.output.available',instanceId,operationId:op.requestId,
   payload:{...identifiers,watermark:run.outputWatermark,truncated:run.truncated}}];
 return[{type:'execution.changed',instanceId,operationId:op.requestId,
   payload:{...identifiers,state:session.state,stateRevision:session.stateRevision,action:op.action,phase:op.phase,outcome:op.outcome,
     ...(op.error?{code:op.error}:{})}}];
}
