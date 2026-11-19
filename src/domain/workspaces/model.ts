import {requireDecimal,requireUuid} from '../identifiers.js';

export const WORKSPACE_STATES=['REQUESTED','CREATING','READY','IN_USE','BLOCKED','RECONCILING','REMOVING','REMOVED'] as const;
export type WorkspaceState=typeof WORKSPACE_STATES[number];
type Action='begin'|'ready'|'acquire'|'release'|'uncertain'|'block'|'remove'|'removed';

const transitions:Readonly<Partial<Record<WorkspaceState,Partial<Record<Action,WorkspaceState>>>>>={
  REQUESTED:{begin:'CREATING',uncertain:'RECONCILING',block:'BLOCKED'},
  CREATING:{ready:'READY',uncertain:'RECONCILING',block:'BLOCKED'},
  READY:{acquire:'IN_USE',remove:'REMOVING',block:'BLOCKED',uncertain:'RECONCILING'},
  IN_USE:{release:'READY',uncertain:'RECONCILING',block:'BLOCKED'},
  RECONCILING:{ready:'READY',block:'BLOCKED',removed:'REMOVED'},
  BLOCKED:{uncertain:'RECONCILING'},
  REMOVING:{removed:'REMOVED',uncertain:'RECONCILING',block:'BLOCKED'},
};

export function transitionWorkspace(current:WorkspaceState,action:Action):WorkspaceState{
 const next=transitions[current]?.[action];
 if(!next)throw new Error('INVALID_TRANSITION');
 return next;
}
export function nextWorkspaceRevision(value:string):string{
 const revision=BigInt(requireDecimal(value));
 if(revision<1n||revision>=9223372036854775807n)throw new Error('REVISION_CONFLICT');
 return String(revision+1n);
}
export function requireWorkspaceCapacity(count:number):void{
 if(!Number.isSafeInteger(count)||count<0)throw new Error('INVALID_REQUEST');
 if(count>=20)throw new Error('WORKSPACE_LIMIT');
}
export interface WorkspaceFence {
 readonly workspaceId:string;
 readonly stateRevision:string;
 readonly ownerGeneration:string;
}
export function requireWorkspaceFence(actual:WorkspaceFence,expected:WorkspaceFence){
 if(requireUuid(actual.workspaceId)!==requireUuid(expected.workspaceId)||requireUuid(actual.ownerGeneration)!==requireUuid(expected.ownerGeneration))throw new Error('STALE_TARGET');
 if(requireDecimal(actual.stateRevision)!==requireDecimal(expected.stateRevision))throw new Error('REVISION_CONFLICT');
}
