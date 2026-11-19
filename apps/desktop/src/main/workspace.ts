import type {ActionService} from './action-handlers.ts';
import type {ArchiveContext} from './archive-context.ts';
import type {BridgeRouter} from './bridge.ts';
import {publicReceipt} from './lifecycle.ts';
import {record,uuid,revision} from '../shared/validation.ts';
import {validateWorkspaceAction,validateWorkspaceData,WORKSPACE_QUERIES,workspaceBridgeAction} from '../shared/workspace-contract.ts';

export function installWorkspace(router:BridgeRouter,context:ArchiveContext,actions:ActionService|null){
 const core=router.services.core;
 if(!core)return;
 const sync=async<T>(work:()=>Promise<T>)=>{try{return await work();}finally{router.setContext(context.current?.view??null);}};
 if(actions)actions.resolveWorkspace=async(action,params)=>{
   validateWorkspaceAction(action,params);
   const c=context.capture();
   if(action==='workspace.refresh'){
     const workspaceId=uuid(params.workspaceId),expectedStateRevision=revision(params.expectedStateRevision);
     const result=await core.call({namespace:'workspace',action:'get',archive:c.path,params:{workspaceId}});
     context.apply(c,result);
     if(result.result!=='OK'||result.liveness!=='LIVE_VERIFIED')throw new Error(result.error?.code??'DAEMON_UNAVAILABLE');
     const workspace=record(validateWorkspaceData('get',result.data).workspace);
     if(workspace.stateRevision!==expectedStateRevision)throw new Error('REVISION_CONFLICT');
     return{command:{namespace:'workspace',action:'refresh',archive:c.path,workspaceId,projectId:uuid(workspace.projectId),expectedStateRevision,params},
       summary:['Aggiorna l’osservazione locale del worktree',`Workspace ${workspaceId}`,`Revisione ${expectedStateRevision}`]};
   }
   const result=await core.call({namespace:'workspace',action:'prepare',archive:c.path,params});
   context.apply(c,result);
   if(result.result!=='OK'||result.liveness!=='LIVE_VERIFIED')throw new Error(result.error?.code??'DAEMON_UNAVAILABLE');
   const data=validateWorkspaceData('prepare',result.data),summary=record(data.summary);
   if(summary.featureId!==params.featureId||summary.envelopeId!==params.envelopeId)throw new Error('CLIENT_PROTOCOL_ERROR');
   const workspaceId=uuid(summary.workspaceId),projectId=uuid(summary.projectId),featureId=uuid(summary.featureId);
   return{command:{namespace:'workspace',action:'create',archive:c.path,workspaceId,projectId,featureId,
     expectedStateRevision:revision(summary.featureRevision),params:{grantId:data.grantId}},
     summary:['Crea un worktree per la feature approvata',`Archivio ${c.path}`,`Feature ${featureId}`,`Handoff ${params.envelopeId}`,
       `Base ${summary.baseRef}`,`Commit ${summary.baseOid}`,`Branch ${summary.branchRef}`]};
 };
 for(const method of Object.keys(WORKSPACE_QUERIES) as (keyof typeof WORKSPACE_QUERIES)[]){
   router.register(method,request=>sync(async()=>{
     const {bridgeVersion:_version,callId:_id,selectionEpoch:_epoch,...params}=request;
     const c=context.capture(),{action}=WORKSPACE_QUERIES[method];
     const result=await core.call({namespace:'workspace',action,archive:c.path,params,scope:'view'});
     context.apply(c,result);
     return{...result,data:validateWorkspaceData(action,result.data)};
   }));
 }
 router.register('prepareWorkspaceAction',request=>sync(()=>{
   if(!actions)throw new Error('RUNTIME_UNAVAILABLE');
   const {method,params}=workspaceBridgeAction(request.params);
   return actions.prepare(method,params);
 }));
 router.register('confirmWorkspaceAction',request=>sync(async()=>{
   if(!actions)throw new Error('RUNTIME_UNAVAILABLE');
   const result=await actions.confirm(uuid(request.confirmationId),['workspace']);
   return{...result,receipt:publicReceipt(result.receipt,context)};
 }));
 router.register('cancelWorkspaceAction',request=>{
   actions?.confirmations.cancel(uuid(request.confirmationId),['workspace']);
   return{cancelled:true};
 });
}
