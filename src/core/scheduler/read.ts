import type {StoragePort} from '../../ports/storage.js';
import type {SchedulerJob} from '../../ports/scheduler.js';
import {featureFields,featureObject} from '../../domain/features/bundle.js';
import {publicSchedulerOperation,requireSchedulerEnvelope,validateSchedulerParams} from '../../protocol/scheduler.js';

const encode=(value:unknown)=>Buffer.from(JSON.stringify(value)).toString('base64url');
function publicJob(job:SchedulerJob){
 const {intentId:_intent,...visible}=job;return visible;
}
export function createSchedulerReader({storage,storeId,offline,dispatchAvailable=false}:{storage:StoragePort;storeId:string;offline:boolean;dispatchAvailable?:boolean}){
 return async(method:string,p:Readonly<Record<string,unknown>>):Promise<Record<string,unknown>>=>{
   validateSchedulerParams(method,p);
   const query=storage.readSchedulerState?.bind(storage);
   if(!query||!storage.readFeatureState)throw new Error('SCHEDULER_NOT_INITIALIZED');
   let data:Record<string,unknown>;
   if(method==='scheduler.queue.list'){
     const projectId=p.projectId===undefined?null:String(p.projectId);
     let offset=0,cursorRevision:unknown;
     if(p.cursor!==undefined){
       let page:Record<string,unknown>;
       try{
         page=featureObject(JSON.parse(Buffer.from(String(p.cursor),'base64url').toString()));
         featureFields(page,['storeId','projectId','revision','offset']);
         if(encode(page)!==p.cursor||!Number.isSafeInteger(page.offset)||Number(page.offset)<1)throw new Error();
       }catch{throw new Error('INVALID_REQUEST');}
       if(page.storeId!==storeId)throw new Error('WRONG_STORE');
       if(page.projectId!==projectId)throw new Error('REVISION_CONFLICT');
       offset=Number(page.offset);cursorRevision=page.revision;
     }
     const [{policy},page]=await Promise.all([query({kind:'policy'}),query({kind:'queue',projectId,offset,limit:Number(p.limit??20)})]);
     if(cursorRevision!==undefined&&page.revision!==cursorRevision)throw new Error('REVISION_CONFLICT');
     const nextCursor=page.nextOffset==null?null:encode({storeId,projectId,revision:page.revision,offset:page.nextOffset});
     data={policy,jobs:(page.jobs??[]).map(publicJob),reservations:(page.reservations??[]).map(({generation:_generation,...reservation})=>reservation),
       nextCursor,dispatchAvailable:!offline&&dispatchAvailable,systemLoad:'UNKNOWN'};
   }else if(method==='scheduler.get'){
     const {job}=await query({kind:'job',id:String(p.jobId)});
     if(!job)throw new Error('OPERATION_NOT_FOUND');
     data={job:publicJob(job)};
   }else if(method==='scheduler.operation.get'){
     const {operation}=await storage.readFeatureState({kind:'operation',id:String(p.requestId)});
     if(!operation)throw new Error('OPERATION_NOT_FOUND');
     data={operation:publicSchedulerOperation(operation)};
   }else throw new Error('UNSUPPORTED_VERSION');
   const result={...data,freshness:offline?'LAST_KNOWN':'CURRENT'};
   requireSchedulerEnvelope(result);return result;
 };
}
