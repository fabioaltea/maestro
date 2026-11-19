import type {ActionService} from './action-handlers.ts';
import type {ArchiveContext} from './archive-context.ts';
import type {BridgeRouter} from './bridge.ts';
import {publicReceipt} from './lifecycle.ts';
import {record,revision,uuid} from '../shared/input.ts';
import {ENVIRONMENT_QUERIES,environmentBridgeAction,validateEnvironmentData} from '../shared/environment-contract.ts';

export function installEnvironment(router:BridgeRouter,context:ArchiveContext,actions:ActionService|null){
 const core=router.services.core;
 if(!core)return;
 const sync=async<T>(run:()=>Promise<T>)=>{try{return await run();}finally{router.setContext(context.current?.view??null);}};
 if(actions)actions.resolveEnvironment=async(route,raw)=>{
   const {action,params}=environmentBridgeAction({...raw,action:route.slice('environment.'.length)}),c=context.capture(),workspaceId=uuid(params.workspaceId);
   const workspace=await core.call({namespace:'workspace',action:'get',archive:c.path,params:{workspaceId}});
   context.apply(c,workspace);
   if(workspace.result!=='OK'||workspace.liveness!=='LIVE_VERIFIED')throw new Error(workspace.error?.code??'DAEMON_UNAVAILABLE');
   const projectId=uuid(record(workspace.data.workspace).projectId);
   const command={namespace:'environment' as const,action,archive:c.path,workspaceId,projectId};
   if(action==='plan'){
     const expectedStateRevision=revision(params.expectedStateRevision);
     return{command:{...command,expectedStateRevision,params},summary:['Leggi manifest e lockfile dal worktree',
       `Workspace ${workspaceId}`,`Revisione ${expectedStateRevision}`,...(params.managerVersion?[`Versione pnpm ${params.managerVersion}`]:[])]};
   }
   const expectedStateRevision=revision(params.stateRevision);
   const result=await core.call({namespace:'environment',action:'authorize',archive:c.path,params:{action,
     intent:{workspaceId,inputDigest:params.inputDigest,limitations:params.limitations},expectedRevisions:{stateRevision:expectedStateRevision}}});
   context.apply(c,result);
   if(result.result!=='OK'||result.liveness!=='LIVE_VERIFIED')throw new Error(result.error?.code??'DAEMON_UNAVAILABLE');
   const data=validateEnvironmentData('authorize',result.data),summary=record(data.summary);
   if(summary.action!==action||summary.workspaceId!==workspaceId||summary.stateRevision!==expectedStateRevision||
     summary.inputDigest!==params.inputDigest||JSON.stringify(summary.limitations)!==JSON.stringify(params.limitations))throw new Error('CLIENT_PROTOCOL_ERROR');
   return{command:{...command,expectedStateRevision,params:{grantId:data.grantId}},summary:['Registra attestazione manuale',
     `Workspace ${workspaceId}`,`Input ${summary.inputDigest}`,...summary.limitations as string[]]};
 };
 for(const method of Object.keys(ENVIRONMENT_QUERIES) as (keyof typeof ENVIRONMENT_QUERIES)[]){
   router.register(method,request=>sync(async()=>{
     const {bridgeVersion:_version,callId:_call,selectionEpoch:_epoch,...params}=request;
     const c=context.capture(),{action}=ENVIRONMENT_QUERIES[method];
     const result=await core.call({namespace:'environment',action,archive:c.path,params,scope:'view'});
     context.apply(c,result);
     return{...result,data:validateEnvironmentData(action,result.data)};
   }));
 }
 router.register('prepareEnvironmentAction',request=>sync(()=>{
   if(!actions)throw new Error('RUNTIME_UNAVAILABLE');
   const {action,params}=environmentBridgeAction(request.params);
   return actions.prepare(`environment.${action}`,params);
 }));
 router.register('confirmEnvironmentAction',request=>sync(async()=>{
   if(!actions)throw new Error('RUNTIME_UNAVAILABLE');
   const result=await actions.confirm(uuid(request.confirmationId),['environment']);
   return{...result,receipt:publicReceipt(result.receipt,context)};
 }));
 router.register('cancelEnvironmentAction',request=>{
   actions?.confirmations.cancel(uuid(request.confirmationId),['environment']);return{cancelled:true};
 });
}
