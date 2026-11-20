import type {StoragePort,StoreSnapshot} from '../../ports/storage.js';
import type {AuthenticatedPeer,RpcRequest,RpcResponse} from '../../ports/platform.js';
import {foundationError} from '../../domain/errors.js';
import {classifyError} from '../control-main.js';
import {environmentResult as reviewResult} from '../environments/dispatch.js';
import {REVIEW_READ_METHODS,requireReviewEnvelope,validateReviewParams} from '../../protocol/review.js';
import {createReviewReader} from './read.js';

export {reviewResult};
export type ReviewAction=(params:Readonly<Record<string,unknown>>,peer:AuthenticatedPeer)=>Promise<Record<string,unknown>>;
export function createReviewDispatch(storage:StoragePort,actions:Readonly<Record<string,ReviewAction>>){
 return async(request:RpcRequest,peer:AuthenticatedPeer,snapshot:StoreSnapshot):Promise<RpcResponse>=>{
   const storeId=snapshot.store.storeId,base={protocolVersion:1 as const,correlationId:request.correlationId};
   try{
     if(peer.role!=='client')throw new Error('UNAUTHORIZED');
     if(snapshot.store.schemaVersion<11)throw new Error('REVIEW_NOT_INITIALIZED');
     validateReviewParams(request.method,request.params);
     const action=actions[request.method];
     let data:Record<string,unknown>;
     if(action)data=await action(request.params,peer);
     else if((REVIEW_READ_METHODS as readonly string[]).includes(request.method))
       data=await createReviewReader({storage,storeId,offline:false})(request.method,request.params);
     else throw new Error('UNSUPPORTED_VERSION');
     const reply={...base,result:reviewResult(data),data:{storeId,...data}};
     requireReviewEnvelope(reply);return reply;
   }catch(error){
     const code=classifyError(error),safe=foundationError(code);
     return{...base,result:safe.category==='SAFETY'?'BLOCKED':code==='BUSY'?'BUSY':'ERROR',data:{storeId,code,error:safe}};
   }
 };
}
