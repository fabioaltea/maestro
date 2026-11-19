import type {StoragePort} from '../../ports/storage.js';
import {WORKSPACE_READ_METHODS,publicWorkspaceOperation,requireWorkspaceEnvelope,validateWorkspaceParams} from '../../protocol/workspace.js';
import {featureFields,featureObject} from '../../domain/features/bundle.js';

export function createWorkspaceReader(options:{
 readonly storage:Pick<StoragePort,'readWorkspaceState'|'readFeatureState'>;
 readonly storeId:string;
 readonly offline:boolean;
}){
 const {storage,storeId,offline}=options;
 const freshness=offline?'LAST_KNOWN':'CURRENT';
 return async(method:string,params:Readonly<Record<string,unknown>>):Promise<Record<string,unknown>>=>{
   validateWorkspaceParams(method,params);
   if(!(WORKSPACE_READ_METHODS as readonly string[]).includes(method))throw new Error('DAEMON_UNAVAILABLE');
   if(!storage.readWorkspaceState||!storage.readFeatureState)throw new Error('WORKSPACE_NOT_INITIALIZED');
   let result:Record<string,unknown>;
   if(method==='workspace.operation.get'){
     const {operation}=await storage.readFeatureState({kind:'operation',id:String(params.requestId)});
     if(!operation||operation.namespace!=='WORKSPACE')throw new Error('OPERATION_NOT_FOUND');
     result={operation:publicWorkspaceOperation(operation)};
   }else if(method==='workspace.list'){
     const projectId=String(params.projectId),limit=typeof params.limit==='number'?params.limit:20;
     let offset=0,revision:string|undefined;
     if(params.cursor!==undefined){
       let cursor:Record<string,unknown>;
       try{cursor=featureObject(JSON.parse(Buffer.from(String(params.cursor),'base64url').toString('utf8')));}
       catch{throw new Error('INVALID_REQUEST');}
       featureFields(cursor,['storeId','projectId','revision','offset']);
       if(cursor.storeId!==storeId||cursor.projectId!==projectId)throw new Error('REVISION_CONFLICT');
       if(typeof cursor.offset!=='number'||!Number.isSafeInteger(cursor.offset)||cursor.offset<0||typeof cursor.revision!=='string')throw new Error('INVALID_REQUEST');
       offset=cursor.offset;revision=cursor.revision;
     }
     const page=await storage.readWorkspaceState({kind:'list',projectId,limit,offset});
     if(revision!==undefined&&page.pageRevision!==revision)throw new Error('REVISION_CONFLICT');
     result={items:page.items,nextCursor:page.nextOffset===null?null:Buffer.from(JSON.stringify({storeId,projectId,revision:page.pageRevision,offset:page.nextOffset})).toString('base64url')};
   }else{
     const workspaceId=String(params.workspaceId),{summary}=await storage.readWorkspaceState({kind:'summary',id:workspaceId});
     if(!summary)throw new Error('WORKSPACE_NOT_FOUND');
     result=method==='workspace.get'?{workspace:summary}:{workspaceId,eligible:false,reason:offline?'UNKNOWN':'CHECK_REQUIRED',checkedAt:null};
   }
   const data={...result,freshness};requireWorkspaceEnvelope(data);return data;
 };
}
