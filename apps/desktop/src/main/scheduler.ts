import type {BridgeRouter} from './bridge.ts';
import type {ArchiveContext} from './archive-context.ts';

export function installScheduler(router:BridgeRouter,context:ArchiveContext){
 const core=router.services.core;
 if(!core)return;
 router.register('listScheduledJobs',async request=>{
   const {bridgeVersion:_version,callId:_call,selectionEpoch:_epoch,...params}=request;
   const archive=context.capture();
   try{
     const result=await core.call({namespace:'scheduler',action:'queue.list',archive:archive.path,params,scope:'view'});
     context.apply(archive,result);
     return result;
   }finally{router.setContext(context.current?.view??null);}
 });
}
