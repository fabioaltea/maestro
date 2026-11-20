import type {AuthenticatedPeer,RpcRequest,RpcResponse} from '../../ports/platform.js';
import type {StoragePort,StoreSnapshot} from '../../ports/storage.js';
import {foundationError} from '../../domain/errors.js';
import {PROFILE_READ_METHODS,requireProfileEnvelope,validateProfileParams} from '../../protocol/profile.js';
import {classifyError} from '../control-main.js';
import {environmentResult} from '../environments/dispatch.js';
import {createProfileReader} from './read.js';

export type ProfileAction=(params:Readonly<Record<string,unknown>>,peer:AuthenticatedPeer)=>Promise<Record<string,unknown>>;
export const profileResult=environmentResult;
export function createProfileDispatch(storage:StoragePort,actions:Readonly<Record<string,ProfileAction>>){
 return async(request:RpcRequest,peer:AuthenticatedPeer,snapshot:StoreSnapshot):Promise<RpcResponse>=>{
   const storeId=snapshot.store.storeId,base={protocolVersion:1 as const,correlationId:request.correlationId};
   try{
     if(peer.role!=='client')throw new Error('UNAUTHORIZED');
     if(snapshot.store.schemaVersion<8)throw new Error('PROFILE_NOT_INITIALIZED');
     validateProfileParams(request.method,request.params);
     const action=actions[request.method];
     const data=action?await action(request.params,peer):(PROFILE_READ_METHODS as readonly string[]).includes(request.method)?
       await createProfileReader({storage,storeId,offline:false})(request.method,request.params):(()=>{throw new Error('UNSUPPORTED_VERSION');})();
     const response={...base,result:profileResult(data),data:{storeId,...data}};
     requireProfileEnvelope(response);return response;
   }catch(error){
     const code=classifyError(error),safe=foundationError(code);
     return{...base,result:safe.category==='SAFETY'?'BLOCKED':code==='BUSY'?'BUSY':'ERROR',data:{storeId,code,error:safe}};
   }
 };
}
