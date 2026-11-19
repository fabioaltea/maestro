import type {AuthenticatedPeer,RpcRequest,RpcResponse} from '../../ports/platform.js';
import type {StoragePort,StoreSnapshot} from '../../ports/storage.js';
import {FEATURE_READ_METHODS,validateFeatureParams,requireFeatureEnvelope} from '../../protocol/feature.js';
import {createFeatureReader} from './read.js';
import {foundationError} from '../../domain/errors.js';
import {classifyError} from '../control-main.js';
export function createFeatureDispatch(options:{readonly storage:StoragePort;readonly mutations?:{readonly methods:readonly string[];run(method:string,p:Readonly<Record<string,unknown>>,peer:AuthenticatedPeer):Promise<Record<string,unknown>>}}){
 return async(request:RpcRequest,peer:AuthenticatedPeer,snapshot:StoreSnapshot):Promise<RpcResponse>=>{
 const base={protocolVersion:1 as const,correlationId:request.correlationId};
 try{if(peer.role!=='client')throw new Error('UNAUTHORIZED');if(snapshot.store.schemaVersion!==5)throw new Error('FEATURE_NOT_INITIALIZED');validateFeatureParams(request.method,request.params);
 let data:Record<string,unknown>;
 if(options.mutations?.methods.includes(request.method))data=await options.mutations.run(request.method,request.params,peer);
 else if((FEATURE_READ_METHODS as readonly string[]).includes(request.method))data=await createFeatureReader({storage:options.storage,storeId:snapshot.store.storeId,offline:false})(request.method,request.params);
 else throw new Error('UNSUPPORTED_VERSION');
 const response={...base,result:'OK' as const,data:{storeId:snapshot.store.storeId,...data}};requireFeatureEnvelope(response);return response;
 }catch(error){const code=classifyError(error);return{...base,result:foundationError(code).category==='SAFETY'?'BLOCKED':'ERROR',data:{storeId:snapshot.store.storeId,code,error:foundationError(code)}};}
 };
}
