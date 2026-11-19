import type {EventDraft} from '../../protocol/messages.js';
import type {WorkspaceRecord} from '../../ports/workspace.js';
import type {WorkflowOperationRecord} from '../../ports/workflow.js';

/** Workspace events carry correlation and state only. Evidence stays with the writer. */
export function workspaceEvents(op:WorkflowOperationRecord,instanceId:string,workspace:WorkspaceRecord):EventDraft[]{
 const payload={scope:'workspace',workspaceId:workspace.workspaceId,featureId:workspace.featureId,projectId:workspace.projectId,
   action:op.action,phase:op.phase,outcome:op.outcome,state:workspace.state,stateRevision:workspace.stateRevision,...(op.error?{code:op.error}:{})};
 const effect=op.phase==='ACCEPTED'?'operation.accepted'
   :op.outcome==='SUCCEEDED'?'operation.completed'
   :op.outcome==='BLOCKED'||op.outcome==='UNKNOWN'?'operation.blocked':'operation.failed';
 const base={instanceId,operationId:op.requestId,payload};
 return [...(op.phase==='WORKING'&&op.outcome==='IN_PROGRESS'?[]:[{type:effect,...base} as EventDraft]),{type:'workspace.changed',...base}];
}
