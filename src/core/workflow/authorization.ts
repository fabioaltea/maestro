import {randomUUID} from 'node:crypto';
import {canonicalWorkflowIntent,type WorkflowIntent,type WorkflowGrant} from '../../domain/workflow/authorization.js';
import type {StoragePort,StoreSnapshot} from '../../ports/storage.js';
import type {ArchivePaths,AuthenticatedPeer} from '../../ports/platform.js';
export function createWorkflowAuthorization(options:{readonly storage:StoragePort;readonly paths:ArchivePaths;readonly instanceId:string;readonly nowMs?:()=>number}){
 const {storage,paths,instanceId}=options,now=options.nowMs??Date.now;
 async function guard(peer:AuthenticatedPeer):Promise<StoreSnapshot>{
 if(peer.role!=='client')throw new Error('UNAUTHORIZED');const s=await storage.readSnapshot();
 if(!s||s.store.ownerUid!==paths.ownerUid||s.store.canonicalPath!==paths.directory||s.instance?.instanceId!==instanceId||s.instance.lifecycle!=='RUNNING')throw new Error('STALE_TARGET');
 if(s.store.schemaVersion<5||!storage.commitFeatureState||!storage.readFeatureState)throw new Error('FEATURE_NOT_INITIALIZED');return s;
 }
 return{guard,
 async prepare(peer:AuthenticatedPeer,intent:WorkflowIntent){const snapshot=await guard(peer);if(intent.storeId!==snapshot.store.storeId||intent.ownerUid!==paths.ownerUid)throw new Error('APPROVAL_REQUIRED');
 const canonicalIntent=canonicalWorkflowIntent(intent),createdAtMs=now();const grant:WorkflowGrant={grantId:randomUUID(),canonicalIntent,createdAtMs,expiresAtMs:createdAtMs+300000,consumedByRequestId:null};
 await storage.commitFeatureState!({kind:'grant',grant});return{grantId:grant.grantId,canonicalIntent,expiresAtMs:grant.expiresAtMs,summary:{action:intent.action,targetId:intent.targetId,projectId:intent.projectId,expectedRevision:intent.expectedRevision,configRevision:intent.configRevision,payload:intent.payload}};
 },
 };
}
