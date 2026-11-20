import {randomUUID} from 'node:crypto';
import type {ActionService} from './action-handlers.ts';
import type {ArchiveContext} from './archive-context.ts';
import type {BridgeRouter} from './bridge.ts';
import {publicReceipt} from './lifecycle.ts';
import {record,revision,uuid} from '../shared/input.ts';
import {PROFILE_QUERIES,profileBridgeAction,validateProfileData} from '../shared/profile-contract.ts';

const labels:Record<string,string>={create:'Crea profilo',revise:'Salva nuova revisione',disable:'Disabilita il profilo',resolve:'Risolvi il profilo',
 'skill.import':'Importa la skill','skill.bind':'Aggiorna le skill del profilo','tool.import':'Registra il manifest del tool','tool.enable':'Abilita il tool nel catalogo'};
export function installProfile(router:BridgeRouter,context:ArchiveContext,actions:ActionService|null){
 const core=router.services.core;
 if(!core)return;
 const sync=async<T>(run:()=>Promise<T>)=>{try{return await run();}finally{router.setContext(context.current?.view??null);}};
 if(actions)actions.resolveProfile=async(route,raw)=>{
   const {action,params}=profileBridgeAction({...raw,action:route.slice('profile.'.length)}),c=context.capture();
   const expectedStateRevision=params.stateRevision===undefined?undefined:revision(params.stateRevision);
   const entityId=params.entityId===undefined?undefined:uuid(params.entityId);
   if(action==='resolve'){
     const {stateRevision:_state,entityId:profileId,...rest}=params;
     return{command:{namespace:'profile',action,archive:c.path,profileId:uuid(profileId),projectId:uuid(params.projectId),
       ...(expectedStateRevision?{expectedStateRevision}:{}),params:{...rest,profileId}},
       summary:[labels.resolve!,`Profilo ${profileId}`,`Revisione ${params.revisionId}`,`Progetto ${params.projectId}`]};
   }
   let intent:Record<string,unknown>;
   if(action==='disable')intent={targetId:entityId,expectedStateRevision};
   else if(action==='skill.import')intent={previewId:params.previewId,sourceDigest:params.sourceDigest};
   else if(action==='skill.bind')intent={profileId:entityId,revisionId:params.revisionId,requiredRefs:params.requiredRefs,recommendedRefs:params.recommendedRefs};
   else{
     const uploaded=await core.call({namespace:'profile',action:'artifact.import',archive:c.path,requestId:randomUUID(),params:record(params.bundle)});
     context.apply(c,uploaded);
     if(uploaded.result!=='OK'||uploaded.liveness!=='LIVE_VERIFIED')throw new Error(uploaded.error?.code??'ARTIFACT_CORRUPT');
     const artifactId=uuid(record(uploaded.data.artifact).artifactId);
     intent=action==='create'?{scope:params.scope,bundleArtifactId:artifactId,...(params.projectId?{projectId:params.projectId}:{})}:
       {profileId:entityId,bundleArtifactId:artifactId};
   }
   const reply=await core.call({namespace:'profile',action:'authorize',archive:c.path,
     params:{action,intent,expectedRevisions:expectedStateRevision?{stateRevision:expectedStateRevision}:{}}});
   context.apply(c,reply);
   if(reply.result!=='OK'||reply.liveness!=='LIVE_VERIFIED')throw new Error(reply.error?.code??'DAEMON_UNAVAILABLE');
   const data=validateProfileData('authorize',reply.data),summary=record(data.summary);
   const id=uuid(summary.entityId);
   if(summary.action!==action||entityId&&id!==entityId||summary.stateRevision!==(expectedStateRevision??null)||
     params.scope!==undefined&&summary.scope!==params.scope||params.projectId!==undefined&&summary.projectId!==params.projectId||
     params.previewId!==undefined&&summary.previewId!==params.previewId||params.sourceDigest!==undefined&&summary.sourceDigest!==params.sourceDigest||
     params.revisionId!==undefined&&summary.revisionId!==params.revisionId)throw new Error('CLIENT_PROTOCOL_ERROR');
   const scope=summary.projectId?{projectId:uuid(summary.projectId)}:{};
   const scopeLabel=summary.scope==='GLOBAL'?'Catalogo globale':summary.projectId?`Progetto ${summary.projectId}`:String(summary.scope??'');
   const permission=summary.permissions&&typeof summary.permissions==='object'&&!Array.isArray(summary.permissions)?record(summary.permissions).allow:summary.permissions;
   const lines=[labels[action]!,...(summary.alias?[`Alias ${summary.alias}`]:[]),...(scopeLabel?[scopeLabel]:[]),
     ...(summary.artifactDigest?[`SHA-256 ${summary.artifactDigest}`]:[]),
     ...(Array.isArray(permission)?[permission.length?`Permessi dichiarati ${permission.join(', ')}`:'Nessun permesso dichiarato']:[])];
   return{command:{namespace:'profile',action,archive:c.path,profileId:id,...scope,...(expectedStateRevision?{expectedStateRevision}:{}),
     params:{grantId:uuid(data.grantId)}},summary:lines};
 };
 for(const method of Object.keys(PROFILE_QUERIES) as (keyof typeof PROFILE_QUERIES)[]){
   router.register(method,request=>sync(async()=>{
     const {bridgeVersion:_version,callId:_call,selectionEpoch:_epoch,...params}=request;
     const c=context.capture(),action=PROFILE_QUERIES[method];
     const result=await core.call({namespace:'profile',action,archive:c.path,params,scope:'view'});
     context.apply(c,result);
     return result;
   }));
 }
 router.register('chooseProfileSkill',request=>sync(async()=>{
   const c=context.capture(),source=await router.services.dialogs.chooseDirectory('Scegli la cartella della skill');
   if(!source)return{cancelled:true};
   if(context.capture().view.selectionEpoch!==c.view.selectionEpoch)throw new Error('STALE_CONTEXT');
   const {bridgeVersion:_version,callId:_call,selectionEpoch:_epoch,...scope}=request;
   const result=await core.call({namespace:'profile',action:'skill.preview',archive:c.path,requestId:randomUUID(),params:{source,...scope}});
   context.apply(c,result);
   if(result.result!=='OK')throw new Error(result.error?.code??'CLIENT_PROTOCOL_ERROR');
   return{preview:validateProfileData('skill.preview',result.data).preview};
 }));
 router.register('prepareProfileAction',request=>sync(()=>{
   if(!actions)throw new Error('RUNTIME_UNAVAILABLE');
   const {action,params}=profileBridgeAction(request.params);
   return actions.prepare(`profile.${action}`,params);
 }));
 router.register('confirmProfileAction',request=>sync(async()=>{
   if(!actions)throw new Error('RUNTIME_UNAVAILABLE');
   const result=await actions.confirm(uuid(request.confirmationId),['profile']);
   return{...result,receipt:publicReceipt(result.receipt,context)};
 }));
 router.register('cancelProfileAction',request=>{
   actions?.confirmations.cancel(uuid(request.confirmationId),['profile']);return{cancelled:true};
 });
}
