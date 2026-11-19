import {canonicalWorkflowIntent,type WorkflowIntent} from '../../domain/workflow/authorization.js';
import {requireUuid} from '../../domain/identifiers.js';
import type {StoragePort} from '../../ports/storage.js';
import type {WorkflowAdmission} from '../../ports/workflow.js';
/** The caller holds the authenticated core scope; the client never supplies an instance or clock. */
export function workflowAdmission(input:{readonly requestId:string;readonly intent:WorkflowIntent;readonly grantId:string|null;readonly instanceId:string;readonly nowMs:number}):WorkflowAdmission{
 requireUuid(input.requestId);requireUuid(input.instanceId);if(input.grantId!==null)requireUuid(input.grantId);
 return{requestId:input.requestId,canonicalIntent:canonicalWorkflowIntent(input.intent),grantId:input.grantId,instanceId:input.instanceId,nowMs:input.nowMs};
}
export async function originalWorkflowGrant(storage:StoragePort,requestId:string,grantId:string,action:string,namespace:WorkflowIntent['namespace']='FEATURE'){
 requireUuid(requestId);requireUuid(grantId);if(!storage.readFeatureState)throw new Error('FEATURE_NOT_INITIALIZED');
 const grant=(await storage.readFeatureState({kind:'grant',id:grantId})).grant;if(!grant)throw new Error('APPROVAL_REQUIRED');
 const intent=JSON.parse(grant.canonicalIntent) as WorkflowIntent;if(intent.action!==action||intent.namespace!==namespace||canonicalWorkflowIntent(intent)!==grant.canonicalIntent)throw new Error('APPROVAL_REQUIRED');
 const operation=(await storage.readFeatureState({kind:'operation',id:requestId})).operation;
 if(operation&&(operation.canonicalIntent!==grant.canonicalIntent||operation.action!==action))throw new Error('IDEMPOTENCY_CONFLICT');
 return{grant,intent,operation};
}
