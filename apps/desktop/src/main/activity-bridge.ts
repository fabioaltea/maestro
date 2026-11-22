import type { BridgeRouter } from './bridge.ts';
import { ArchiveContext } from './archive-context.ts';
import { ClientLifecycle } from './client-lifecycle.ts';
import type { Runtime } from './runtime.ts';
import { ActivityStream } from './activity-stream.ts';
import { decodeActivityCursor } from '../shared/activity-contract.ts';
import { ACTIVITY_CHANNEL } from '../shared/bridge-contract.ts';
import { text } from '../shared/validation.ts';
export function installActivityStream(router:BridgeRouter,context:ArchiveContext,lifecycle:ClientLifecycle,runtime:Runtime|null){
 let active:{stream:ActivityStream;untrack:()=>unknown}|null=null,changing=false;
 router.register('startEvents',async request=>{
  if(!runtime)throw new Error('RUNTIME_UNAVAILABLE');if(changing)throw new Error('LOCAL_BUSY');changing=true;
  try{
   if(active){await active.stream.close();active.untrack();active=null;}
   const c=context.capture(),after=text(request.afterApplied,256),cursor=decodeActivityCursor(after);
   if(!c.view.storeId||cursor.storeId!==c.view.storeId)throw new Error('STREAM_GAP');
   const stream=new ActivityStream({runtime,archive:c.path,storeId:c.view.storeId,epoch:c.view.selectionEpoch,after,onMessage(message){
    if(router.window.isDestroyed()||router.window.webContents.isDestroyed()||context.current?.view.selectionEpoch!==c.view.selectionEpoch)return;
    router.window.webContents.send(ACTIVITY_CHANNEL,message);
   }});
   const entry={stream,untrack:lifecycle.addArchiveCleanup(()=>{void stream.close().catch(()=>undefined);})};active=entry;
   try{const ready=await stream.start();return{...ready,lastAppliedCursor:stream.lastAppliedCursor};}
   catch(error){await stream.close(false).catch(()=>undefined);entry.untrack();if(active===entry)active=null;throw error;}
  }finally{changing=false;}
 });
 router.register('ackEvents',request=>{
  if(!active||active.stream.subscriptionId!==request.subscriptionId)throw new Error('STALE_CONTEXT');
  return active.stream.ack(text(request.batchId),text(request.lastAppliedSeq));
 });
 router.register('stopEvents',async request=>{
  const entry=active;if(!entry)return{closed:true};
  if(entry.stream.subscriptionId!==request.subscriptionId)throw new Error('STALE_CONTEXT');
  await entry.stream.close();entry.untrack();if(active===entry)active=null;
  return{closed:true,lastAppliedCursor:entry.stream.lastAppliedCursor};
 });
}
