import type {EventDraft} from './messages.js';
import type {WorkflowOperationRecord} from '../ports/workflow.js';
import type {WorkflowIntent} from '../domain/workflow/authorization.js';
import type {FeatureRecord} from '../domain/features/model.js';
/** Metadata allowlist. No canonical input, title, chunk, answer, digest or filesystem path. */
export function workflowEventDrafts(op:WorkflowOperationRecord,instanceId:string,feature?:FeatureRecord|null):EventDraft[]{
 const intent=JSON.parse(op.canonicalIntent) as WorkflowIntent,scope=op.namespace==='FEATURE'?'feature':'artifact';
 const payload:Record<string,unknown>={scope,action:op.action,phase:op.phase,outcome:op.outcome};
 if(intent.projectId)payload.projectId=intent.projectId;
 if(scope==='feature'&&op.targetId)payload.featureId=op.targetId;
 if(scope==='artifact'){const id=op.result?.artifactId??intent.payload.artifactId??(op.action==='reserve'?op.requestId:null);if(typeof id==='string')payload.artifactId=id;}
 if(feature){payload.state=feature.state;payload.stateRevision=feature.stateRevision;}
 if(op.error)payload.code=op.error;
 const type:EventDraft['type']=op.phase==='ACCEPTED'?'operation.accepted':op.outcome==='SUCCEEDED'?'operation.completed':op.outcome==='UNKNOWN'||op.outcome==='BLOCKED'?'operation.blocked':'operation.failed';
 const common={instanceId,operationId:op.requestId,payload};
 return[{type,...common},{type:scope==='feature'?'feature.changed':'artifact.changed',...common}];
}
