import type {StoragePort,StoreSnapshot} from '../../ports/storage.js';
import type {AuthenticatedPeer,RpcRequest,RpcResponse} from '../../ports/platform.js';
import {foundationError} from '../../domain/errors.js';
import {classifyError} from '../control-main.js';
import {environmentResult as schedulerResult} from '../environments/dispatch.js';
import {SCHEDULER_READ_METHODS,requireSchedulerEnvelope,validateSchedulerParams} from '../../protocol/scheduler.js';
import {createSchedulerReader} from './read.js';

export {schedulerResult};
export type SchedulerAction=(params:Readonly<Record<string,unknown>>,peer:AuthenticatedPeer)=>Promise<Record<string,unknown>>;
export function createSchedulerDispatch(storage:StoragePort,actions:Readonly<Record<string,SchedulerAction>>,dispatchAvailable=false){
 return async(request:RpcRequest,peer:AuthenticatedPeer,snapshot:StoreSnapshot):Promise<RpcResponse>=>{
   const storeId=snapshot.store.storeId,base={protocolVersion:1 as const,correlationId:request.correlationId};
   try{
     if(peer.role!=='client')throw new Error('UNAUTHORIZED');
     if(snapshot.store.schemaVersion<10)throw new Error('SCHEDULER_NOT_INITIALIZED');
     validateSchedulerParams(request.method,request.params);
     const action=actions[request.method];
     let data:Record<string,unknown>;
     if(action)data=await action(request.params,peer);
     else if((SCHEDULER_READ_METHODS as readonly string[]).includes(request.method))
       data=await createSchedulerReader({storage,storeId,offline:false,dispatchAvailable})(request.method,request.params);
     else throw new Error('UNSUPPORTED_VERSION');
     const reply={...base,result:schedulerResult(data),data:{storeId,...data}};
     requireSchedulerEnvelope(reply);return reply;
   }catch(error){
     const code=classifyError(error),safe=foundationError(code);
     return{...base,result:safe.category==='SAFETY'?'BLOCKED':code==='BUSY'?'BUSY':'ERROR',data:{storeId,code,error:safe}};
   }
 };
}
