import type {StoragePort,StoreSnapshot} from '../../ports/storage.js';
import type {AuthenticatedPeer,RpcRequest,RpcResponse} from '../../ports/platform.js';
import {foundationError} from '../../domain/errors.js';
import {classifyError} from '../control-main.js';
import {EXECUTION_READ_METHODS,requireExecutionEnvelope,validateExecutionParams} from '../../protocol/execution.js';
import {environmentResult as executionResult} from '../environments/dispatch.js';
import {createExecutionReader} from './read.js';

export {executionResult};
export type ExecutionAction=(params:Readonly<Record<string,unknown>>,peer:AuthenticatedPeer)=>Promise<Record<string,unknown>>;
export function createExecutionDispatch(storage:StoragePort,actions:Readonly<Record<string,ExecutionAction>>){
 return async(request:RpcRequest,peer:AuthenticatedPeer,snapshot:StoreSnapshot):Promise<RpcResponse>=>{
   const storeId=snapshot.store.storeId,base={protocolVersion:1 as const,correlationId:request.correlationId};
   try{
     if(peer.role!=='client')throw new Error('UNAUTHORIZED');
     if(snapshot.store.schemaVersion<9)throw new Error('EXECUTION_NOT_INITIALIZED');
     validateExecutionParams(request.method,request.params);
     const action=actions[request.method];
     const data=action?await action(request.params,peer):(EXECUTION_READ_METHODS as readonly string[]).includes(request.method)?
       await createExecutionReader({storage,storeId,offline:false})(request.method,request.params):(()=>{throw new Error('EXECUTION_UNSUPPORTED');})();
     const response={...base,result:executionResult(data),data:{storeId,...data}};
     requireExecutionEnvelope(response);return response;
   }catch(error){
     const code=classifyError(error),safe=foundationError(code);
     return{...base,result:safe.category==='SAFETY'?'BLOCKED':['BUSY','WORKSPACE_IN_USE'].includes(code)?'BUSY':'ERROR',data:{storeId,code,error:safe}};
   }
 };
}
