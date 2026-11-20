import type {BridgeRouter} from './bridge.ts';
import type {ArchiveContext} from './archive-context.ts';
import {ArchiveReader} from './read-handlers.ts';
import {REVIEW_BRIDGE_METHODS} from '../shared/review-contract.ts';

export function installReview(router:BridgeRouter,context:ArchiveContext){
 const core=router.services.core;
 if(!core)return;
 const reader=new ArchiveReader(context,core);
 for(const method of REVIEW_BRIDGE_METHODS)router.register(method,async request=>{
   const {bridgeVersion:_version,callId:_call,selectionEpoch:_epoch,...params}=request;
   try{return await reader.read(method,params);}
   finally{router.setContext(context.current?.view??null);}
 });
}
