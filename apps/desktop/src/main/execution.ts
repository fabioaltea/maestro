import type {ActionService} from './action-handlers.ts';
import type {ArchiveContext} from './archive-context.ts';
import type {BridgeRouter} from './bridge.ts';
import type {CliCommand} from './ports.ts';
import {publicReceipt} from './lifecycle.ts';
import {record,uuid} from '../shared/input.ts';
import {EXECUTION_QUERIES,executionBridgeAction} from '../shared/execution-contract.ts';

const labels:Record<string,string>={'provider.configure':'Salva configurazione provider','provider.check':'Verifica provider',
 start:'Avvia sessione',answer:'Invia risposta',pause:'Metti in pausa',cancel:'Annulla il run',checkpoint:'Salva checkpoint',
 resume:'Riprendi dal checkpoint',reconcile:'Riconcilia lo stato del run'};
export function installExecution(router:BridgeRouter,context:ArchiveContext,actions:ActionService|null){
 const core=router.services.core;
 if(!core)return;
 const sync=async<T>(run:()=>Promise<T>)=>{try{return await run();}finally{router.setContext(context.current?.view??null);}};
 if(actions)actions.resolveExecution=async(route,raw)=>{
   const {action,params}=executionBridgeAction({...raw,action:route.slice('execution.'.length)}),c=context.capture();
   const command:CliCommand={namespace:'execution',action,archive:c.path};
   if(action==='provider.check'||action==='reconcile'){
     const target=params.sessionId===undefined?null:uuid(params.sessionId);
     return{command:{...command,params,executionTarget:target},summary:[labels[action]!,String(params.sessionId??params.providerId)]};
   }
   const {configRevision,stateRevision,...intent}=params;
   const expected=stateRevision??params.expectedStateRevision??params.expectedRevision;
   const expectedRevisions=action==='provider.configure'?{configRevision}:expected===undefined?{}:{stateRevision:expected};
   const reply=await core.call({namespace:'execution',action:'authorize',archive:c.path,params:{action,intent,expectedRevisions}});
   context.apply(c,reply);
   if(reply.result!=='OK'||reply.liveness!=='LIVE_VERIFIED')throw new Error(reply.error?.code??'DAEMON_UNAVAILABLE');
   const summary=record(reply.data.summary),payload=record(summary.payload);
   if(summary.action!==action||action==='provider.configure'&&summary.configRevision!==configRevision||
      expected!==undefined&&summary.expectedRevision!==expected||
      (params.featureId??params.interactionId??params.sessionId)!==undefined&&summary.targetId!==(params.featureId??params.interactionId??params.sessionId))
     throw new Error('CLIENT_PROTOCOL_ERROR');
   for(const key of ['providerId','workspaceId','profileResolutionId','envelopeId','checkpointId','answerArtifactId','modelId']){
     if(params[key]!==undefined&&params[key]!==payload[key])throw new Error('CLIENT_PROTOCOL_ERROR');
   }
   const projectId=summary.projectId===null?undefined:uuid(summary.projectId),target=summary.targetId===null?null:uuid(summary.targetId);
   return{command:{...command,params:{grantId:uuid(reply.data.grantId)},executionTarget:target,...(projectId?{projectId}:{}),
     ...(typeof summary.expectedRevision==='string'?{expectedStateRevision:summary.expectedRevision}:{})},
     summary:[labels[action]!,...(target?[target]:[]),...(payload.providerId?[String(payload.providerId)]:[]),
       ...(payload.workspaceId?[`Workspace ${payload.workspaceId}`]:[]),...(payload.treeDigest?[`SHA-256 ${payload.treeDigest}`]:[])]};
 };
 for(const method of Object.keys(EXECUTION_QUERIES) as (keyof typeof EXECUTION_QUERIES)[]){
   router.register(method,request=>sync(async()=>{
     const {bridgeVersion:_version,callId:_call,selectionEpoch:_epoch,...params}=request,c=context.capture();
     const result=await core.call({namespace:'execution',action:EXECUTION_QUERIES[method],archive:c.path,params,scope:'view'});
     context.apply(c,result);
     return result;
   }));
 }
 router.register('prepareExecutionAction',request=>sync(()=>{
   if(!actions)throw new Error('RUNTIME_UNAVAILABLE');
   const {action,params}=executionBridgeAction(request.params);
   return actions.prepare(`execution.${action}`,params);
 }));
 router.register('confirmExecutionAction',request=>sync(async()=>{
   if(!actions)throw new Error('RUNTIME_UNAVAILABLE');
   const result=await actions.confirm(uuid(request.confirmationId),['execution']);
   return{...result,receipt:publicReceipt(result.receipt,context)};
 }));
 router.register('cancelExecutionAction',request=>{
   actions?.confirmations.cancel(uuid(request.confirmationId),['execution']);return{cancelled:true};
 });
}
