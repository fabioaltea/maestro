import {requireUuid} from '../identifiers.js';
import {envelopeContent,requireCurrentFeatureApproval} from '../features/approval.js';
import type {FeatureApproval,FeatureRecord,FeatureRevision,ImplementationEnvelope} from '../features/model.js';
import type {FeatureContextProof} from '../../ports/feature.js';
import type {WorkspaceDiskObservation} from '../../ports/workspace.js';

export function workspaceBranchRef(featureId:string,workspaceId:string){
 return `refs/heads/maestro/feature/${requireUuid(featureId)}/${requireUuid(workspaceId)}`;
}

export function requireProvisioningObservation(baseOid:string,observation:WorkspaceDiskObservation,phase:'ABSENT'|'BRANCH_CREATED'|'WORKTREE_ADDED'){
 if(observation.baseOid!==baseOid)throw new Error('BASE_CHANGED');
 if(phase==='ABSENT'){
   if(observation.branchOid!==null)throw new Error('BRANCH_EXISTS');
   if(observation.worktree)throw new Error('OWNERSHIP_UNPROVEN');
   return;
 }
 if(observation.branchOid!==baseOid||phase==='BRANCH_CREATED'&&observation.worktree
   ||phase==='WORKTREE_ADDED'&&observation.worktree?.headOid!==baseOid)throw new Error('OWNERSHIP_UNPROVEN');
}
export function requireWorkspaceHandoff(feature:FeatureRecord,revision:FeatureRevision,approval:FeatureApproval|null,
 envelope:ImplementationEnvelope,proof:FeatureContextProof,ownerUid:number){
 requireCurrentFeatureApproval(feature,revision,approval,proof,ownerUid);
 const expected=envelopeContent(feature,revision,approval);
 if(Object.entries(expected).some(([key,value])=>envelope[key as keyof typeof expected]!==value))throw new Error('APPROVAL_STALE');
 return expected;
}
