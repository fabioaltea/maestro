import type {AuthenticatedPeer,RpcRequest,RpcResponse} from '../../ports/platform.js';
import type {StoragePort,StoreSnapshot} from '../../ports/storage.js';
import {foundationError} from '../../domain/errors.js';
import {classifyError} from '../control-main.js';
import {WORKSPACE_READ_METHODS,requireWorkspaceEnvelope,validateWorkspaceParams} from '../../protocol/workspace.js';
import {createWorkspaceReader} from './read.js';

export function workspaceResult(data:Record<string,unknown>):RpcResponse['result']{
 const operation=data.operation as {outcome?:string}|undefined;
 if(!operation||operation.outcome==='SUCCEEDED')return 'OK';
 if(operation.outcome==='IN_PROGRESS')return 'BUSY';
 if(operation.outcome==='UNKNOWN')return 'UNKNOWN_OUTCOME';
 return operation.outcome==='BLOCKED'?'BLOCKED':'ERROR';
}
export function createWorkspaceDispatch(options:{
 readonly storage:StoragePort;
 readonly composed?:Readonly<Record<string,(params:Readonly<Record<string,unknown>>,peer:AuthenticatedPeer)=>Promise<Record<string,unknown>>>>;
}){
 return async(request:RpcRequest,peer:AuthenticatedPeer,snapshot:StoreSnapshot):Promise<RpcResponse>=>{
   const storeId=snapshot.store.storeId;
   const base={protocolVersion:1 as const,correlationId:request.correlationId};
   try{
     if(peer.role!=='client')throw new Error('UNAUTHORIZED');
     if(snapshot.store.schemaVersion<6)throw new Error('WORKSPACE_NOT_INITIALIZED');
     validateWorkspaceParams(request.method,request.params);
     const action=options.composed?.[request.method];
     let data:Record<string,unknown>;
     if(action)data=await action(request.params,peer);
     else if((WORKSPACE_READ_METHODS as readonly string[]).includes(request.method))
       data=await createWorkspaceReader({storage:options.storage,storeId,offline:false})(request.method,request.params);
     else throw new Error('UNSUPPORTED_VERSION');
     const response={...base,result:workspaceResult(data),data:{storeId,...data}};
     requireWorkspaceEnvelope(response);return response;
   }catch(error){
     const code=classifyError(error),safe=foundationError(code);
     return{...base,result:safe.category==='SAFETY'?'BLOCKED':['BUSY','WORKSPACE_IN_USE'].includes(code)?'BUSY':'ERROR',data:{storeId,code,error:safe}};
   }
 };
}
