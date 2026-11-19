import {randomUUID} from 'node:crypto';
import {requireWorkspaceOwnership,requireWorkspaceRelease,WORKSPACE_HOLDERS,type WorkspaceHolder} from '../../domain/workspaces/ownership.js';
import {requireWorkspaceFence} from '../../domain/workspaces/model.js';
import type {StoragePort} from '../../ports/storage.js';
import type {OwnedWorkspaceFilesPort,WorkspaceLease,WorkspaceLeaseRequest,WorkspacePort,WorkspaceRecord,WorkspaceReleaseProof} from '../../ports/workspace.js';
import {makeDeadline,systemClock} from '../../ports/clock.js';

interface LeaseOptions{
 readonly storage:StoragePort;readonly instanceId:string;readonly files:OwnedWorkspaceFilesPort;readonly mutator:WorkspacePort;
 accepting():boolean;
}
export function workspaceFence(workspace:WorkspaceRecord){
 const {workspaceId,stateRevision,ownerGeneration}=workspace;
 return{workspaceId,stateRevision,ownerGeneration};
}
async function findWorkspace(storage:StoragePort,workspaceId:string){
 const {workspace}=await storage.readWorkspaceState!({kind:'get',id:workspaceId});
 if(!workspace)throw new Error('WORKSPACE_NOT_FOUND');
 return workspace;
}
export async function verifyOwnedWorktree(options:Pick<LeaseOptions,'files'|'mutator'>,storeId:string,workspace:WorkspaceRecord){
 const observed=await options.mutator.observe(workspace.target,makeDeadline(systemClock,10000));
 const marker=await options.files.readMarker(workspace.target.ownedRoot,workspace.workspaceId);
 return requireWorkspaceOwnership(storeId,workspace,marker,observed);
}

/** Internal bindings are issued to composed consumers only. No wire method acquires or releases a writer. */
export function createWorkspaceLeases(options:LeaseOptions){
 const {storage,instanceId}=options;
 function forConsumer(holderType:WorkspaceHolder){
   if(!WORKSPACE_HOLDERS.includes(holderType))throw new Error('INVALID_REQUEST');
   return{
     async acquire(request:WorkspaceLeaseRequest){
       if(!options.accepting())throw new Error('BLOCKED');
       const {workspaceId,holderId,generation,stateRevision}=request;
       const snapshot=await storage.readSnapshot();
       if(!snapshot||snapshot.instance?.instanceId!==instanceId||snapshot.instance.lifecycle!=='RUNNING')throw new Error('STALE_TARGET');
       const {lease:held}=await storage.readWorkspaceState!({kind:'active-lease',id:workspaceId});
       if(held){
         if(held.holderType===holderType&&held.holderId===holderId&&held.generation===generation&&held.instanceId===instanceId)return held;
         throw new Error('WORKSPACE_IN_USE');
       }
       const workspace=await findWorkspace(storage,workspaceId),fence={...workspaceFence(workspace),stateRevision};
       requireWorkspaceFence(workspace,fence);
       if(workspace.state!=='READY')throw new Error('WORKSPACE_IN_USE');
       const worktree=await verifyOwnedWorktree(options,snapshot.store.storeId,workspace);
       const lease:WorkspaceLease={leaseId:randomUUID(),workspaceId,holderType,holderId,generation,instanceId};
       if(!options.accepting())throw new Error('BLOCKED');
       return storage.commitWorkspaceLease!({kind:'acquire',lease,fence,worktree});
     },
     async release(lease:WorkspaceLease,proof:WorkspaceReleaseProof){
       if(lease.holderType!==holderType)throw new Error('STALE_TARGET');
       requireWorkspaceRelease(lease,proof);
       const snapshot=await storage.readSnapshot();
       if(!snapshot||snapshot.instance?.instanceId!==instanceId)throw new Error('STALE_TARGET');
       const workspace=await findWorkspace(storage,lease.workspaceId);
       let worktree=null;
       try{worktree=await verifyOwnedWorktree(options,snapshot.store.storeId,workspace);}
       catch{/* A proven exit allows release while changed ownership keeps the workspace blocked. */}
       return storage.commitWorkspaceLease!({kind:'release',lease,instanceId,proof,worktree});
     },
   };
 }
 return{forConsumer,async recover(){
   const {leases}=await storage.readWorkspaceState!({kind:'interrupted-leases'});
   for(const lease of leases??[])if(lease.instanceId!==instanceId)await storage.commitWorkspaceLease!({kind:'owner-lost',lease,instanceId});
 }};
}
