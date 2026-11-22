import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Desktop } from './desktop.ts';
import type { ActivityState } from './activity.ts';
import { appendActivity } from './activity.ts';
import { decodeUiEvent, decodeActivityCursor, encodeActivityCursor } from '../../shared/activity-contract.ts';
import type { ActivityMessage } from '../../shared/bridge-contract.ts';
import { record, uuid, text } from '../../shared/validation.ts';
export interface Connection {state:string;code:string|null;cursor:string|null;firstAvailable?:string;highWater?:string}
export function useActivityStream(desktop:Desktop,state:ActivityState,setState:(value:ActivityState)=>void){
 const[connection,setConnection]=useState<Connection>({state:'IDLE',code:null,cursor:null});
 const applied=useRef(state),subscription=useRef<string|null>(null),starting=useRef(false),alive=useRef(true),early=useRef<ActivityMessage[]>([]);
 const checkpoint=useRef<string|null>(null),pending=useRef<{batchId:string;seq:string;subscriptionId:string}|null>(null);
 const{context,invoke}=desktop;const epoch=context?.selectionEpoch??0;
 useLayoutEffect(()=>{applied.current=state;
  const batch=pending.current;if(!batch)return;pending.current=null;
  void window.maestro.ackEvents({bridgeVersion:1,callId:crypto.randomUUID(),selectionEpoch:epoch,subscriptionId:batch.subscriptionId,batchId:batch.batchId,lastAppliedSeq:batch.seq}).then(response=>{
   if(!alive.current||subscription.current!==batch.subscriptionId)return;
   if(response.error){setConnection(c=>({...c,state:'DISCONNECTED',code:response.error!.code}));return;}
   const cursor=text(record(response.result).cursor,256),next=decodeActivityCursor(cursor);
   if(!checkpoint.current||BigInt(next.seq)>=BigInt(decodeActivityCursor(checkpoint.current).seq))checkpoint.current=cursor;
  }).catch(()=>{if(alive.current)setConnection(c=>({...c,state:'DISCONNECTED',code:'CLIENT_PROTOCOL_ERROR'}));});
 },[state,epoch]);
 function receive(message:ActivityMessage){
  if(!alive.current||message.selectionEpoch!==epoch)return;
  if(!subscription.current){if(starting.current){if(early.current.length>=4){setConnection(c=>({...c,state:'SATURATED',code:'STREAM_SATURATED'}));}else early.current.push(message);}return;}
  if(message.subscriptionId!==subscription.current)return;
  try{
   if(message.kind==='activity.state'){
    const cursor=typeof message.lastAppliedCursor==='string'?message.lastAppliedCursor:checkpoint.current;
    checkpoint.current=cursor;
    setConnection({state:text(message.state),code:typeof message.code==='string'?message.code:null,cursor,...(typeof message.firstAvailable==='string'?{firstAvailable:message.firstAvailable}:{}),...(typeof message.highWater==='string'?{highWater:message.highWater}:{})});return;
   }
   if(message.kind!=='activity.batch'||pending.current||!Array.isArray(message.events)||message.events.length>32||!applied.current.storeId)throw new Error('STREAM_GAP');
   const events=message.events.map(e=>decodeUiEvent(e,applied.current.storeId!)),next=appendActivity(applied.current,events),cursor=text(message.cursor,256),decoded=decodeActivityCursor(cursor);
   if(!events.length||decoded.seq!==events.at(-1)!.seq||decoded.storeId!==next.storeId)throw new Error('STREAM_GAP');
   pending.current={batchId:uuid(message.batchId),seq:events.at(-1)!.seq,subscriptionId:subscription.current};
   setState({...next,cursor:encodeActivityCursor(next.storeId!,next.appliedSeq!)});
  }catch{setConnection(c=>({...c,state:'GAP',code:'STREAM_GAP'}));const id=subscription.current;if(id)void invoke('stopEvents',{subscriptionId:id});}
 }
 useEffect(()=>{
  alive.current=true;const off=window.maestro.onActivity(receive);
  return()=>{alive.current=false;off();const id=subscription.current;subscription.current=null;pending.current=null;if(id)void invoke('stopEvents',{subscriptionId:id});};
 },[epoch,invoke]);
 async function start(after:string){
  if(starting.current)return;starting.current=true;subscription.current=null;early.current=[];
  setConnection(c=>({...c,state:'CONNECTING',code:null}));
  const value=await invoke('startEvents',{afterApplied:after});
  if(!alive.current){if(value){const id=record(value).subscriptionId;if(typeof id==='string')void invoke('stopEvents',{subscriptionId:id});}starting.current=false;return;}
  starting.current=false;
  if(!value){const last=early.current.findLast(m=>m.kind==='activity.state');setConnection({state:last?.state==='GAP'?'GAP':'DISCONNECTED',code:typeof last?.code==='string'?last.code:'SERVICE_UNREACHABLE',cursor:checkpoint.current,...(typeof last?.firstAvailable==='string'?{firstAvailable:last.firstAvailable}:{}),...(typeof last?.highWater==='string'?{highWater:last.highWater}:{})});early.current=[];return;}
  subscription.current=uuid(record(value).subscriptionId);checkpoint.current=after;setConnection({state:'LIVE',code:null,cursor:after});
  const buffered=early.current;early.current=[];for(const message of buffered)receive(message);
 }
 async function stop(){const id=subscription.current;if(!id)return;const value=await invoke('stopEvents',{subscriptionId:id});if(value&&typeof record(value).lastAppliedCursor==='string')checkpoint.current=String(record(value).lastAppliedCursor);subscription.current=null;pending.current=null;setConnection(c=>({...c,state:'DISCONNECTED',cursor:checkpoint.current}));}
 function reset(){checkpoint.current=null;setConnection({state:'IDLE',code:null,cursor:null});}
 return{connection,start,stop,reset,checkpoint:()=>checkpoint.current};
}
