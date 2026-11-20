import {ArchiveReader} from './read-handlers.ts';
import type {BridgeRouter} from './bridge.ts';
import type {ArchiveContext} from './archive-context.ts';

export function installScheduler(router:BridgeRouter,context:ArchiveContext){
 const core=router.services.core;
 if(!core)return;
 router.register('listScheduledJobs',async request=>{
   const {bridgeVersion:_version,callId:_call,selectionEpoch:_epoch,...params}=request;
   try{return await new ArchiveReader(context,core).read('listScheduledJobs',params);}
   finally{router.setContext(context.current?.view??null);}
 });
}
