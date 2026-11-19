import type {StoragePort,StoreSnapshot} from '../../ports/storage.js';
import type {AuthenticatedPeer,RpcRequest,RpcResponse} from '../../ports/platform.js';
import {foundationError} from '../../domain/errors.js';
import {classifyError} from '../control-main.js';
import {ENVIRONMENT_READ_METHODS,requireEnvironmentEnvelope,validateEnvironmentParams} from '../../protocol/environment.js';
import {createEnvironmentReader} from './read.js';

export type EnvironmentRpcAction=(params:Readonly<Record<string,unknown>>,peer:AuthenticatedPeer)=>Promise<Record<string,unknown>>;
export function environmentResult(data:Record<string,unknown>):RpcResponse['result']{
 const outcome=(data.operation as {outcome?:string}|undefined)?.outcome;
 if(!outcome||outcome==='SUCCEEDED')return 'OK';
 if(outcome==='IN_PROGRESS')return 'BUSY';
 if(outcome==='UNKNOWN')return 'UNKNOWN_OUTCOME';
 return outcome==='BLOCKED'?'BLOCKED':'ERROR';
}
export function createEnvironmentDispatch(options:{storage:StoragePort;actions?:Readonly<Record<string,EnvironmentRpcAction>>}){
 return async(request:RpcRequest,peer:AuthenticatedPeer,snapshot:StoreSnapshot):Promise<RpcResponse>=>{
   const storeId=snapshot.store.storeId,base={protocolVersion:1 as const,correlationId:request.correlationId};
   try{
     if(peer.role!=='client')throw new Error('UNAUTHORIZED');
     if(snapshot.store.schemaVersion<7)throw new Error('ENVIRONMENT_NOT_INITIALIZED');
     validateEnvironmentParams(request.method,request.params);
     const action=options.actions?.[request.method];
     let data:Record<string,unknown>;
     if(action)data=await action(request.params,peer);
     else if((ENVIRONMENT_READ_METHODS as readonly string[]).includes(request.method))
       data=await createEnvironmentReader({storage:options.storage,storeId,offline:false})(request.method,request.params);
     else throw new Error('UNSUPPORTED_VERSION');
     const response={...base,result:environmentResult(data),data:{storeId,...data}};
     requireEnvironmentEnvelope(response);
     return response;
   }catch(error){
     const code=classifyError(error),safe=foundationError(code);
     return{...base,result:safe.category==='SAFETY'?'BLOCKED':['BUSY','WORKSPACE_IN_USE'].includes(code)?'BUSY':'ERROR',data:{storeId,code,error:safe}};
   }
 };
}
