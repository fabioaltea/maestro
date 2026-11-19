import type {WorkspaceCleanupTarget,WorkspaceDiskObservation,WorkspaceWorkingStatus} from '../../ports/workspace.js';
import type {WorkspaceState} from './model.js';

export function requireCleanupTarget(target:WorkspaceCleanupTarget,branchRef:string){
 if(!/^refs\/heads\/[!-~]{1,1024}$/.test(target.targetRef)||target.targetRef===branchRef
   ||!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(target.targetOid))throw new Error('INVALID_REQUEST');
}

export function requireCleanupConditions(proof:{
 readonly state:WorkspaceState;readonly holder:boolean;readonly effect:boolean;
 readonly targetOid:string;readonly observedTargetOid:string|null;
 readonly integrated:boolean;readonly status:WorkspaceWorkingStatus|null;
}){
 if(!['READY','REMOVING'].includes(proof.state)||proof.holder||proof.effect)throw new Error('WORKSPACE_IN_USE');
 if(proof.observedTargetOid!==proof.targetOid)throw new Error('BASE_CHANGED');
 if(!proof.status)throw new Error('OWNERSHIP_UNPROVEN');
 const {tracked,untracked,ignored,conflicts}=proof.status;
 if(conflicts)throw new Error('GIT_CONFLICT');
 if(tracked||untracked||ignored||!proof.integrated)throw new Error('UNINTEGRATED_WORK');
}

export function requireCleanupEffect(observation:Pick<WorkspaceDiskObservation,'worktree'|'branchOid'>,headOid:string,
 stage:'WORKTREE_REMOVED'|'BRANCH_REMOVED'){
 if(observation.worktree||observation.branchOid!==(stage==='WORKTREE_REMOVED'?headOid:null))throw new Error('OWNERSHIP_UNPROVEN');
}
