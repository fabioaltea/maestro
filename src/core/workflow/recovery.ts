import type {StoragePort} from '../../ports/storage.js';
import type {WorkflowOperationRecord} from '../../ports/workflow.js';
export async function recoverWorkflow(storage:StoragePort,instanceId:string):Promise<boolean>{
 const snapshot=await storage.readSnapshot();if((snapshot?.store.schemaVersion??0)<5)return false;
 if(!storage.reconcileWorkflowArtifacts||!storage.commitFeatureState||!storage.readFeatureState)throw new Error('FEATURE_NOT_INITIALIZED');
 await storage.reconcileWorkflowArtifacts();await storage.commitFeatureState({kind:'reconcile',instanceId,nowMs:Date.now()});
 const pending=(await storage.readFeatureState({kind:'pending'})).items as readonly WorkflowOperationRecord[];
 return !pending.some(p=>p.outcome==='UNKNOWN'&&!['generate','answer','cancel'].includes(p.action));
}
