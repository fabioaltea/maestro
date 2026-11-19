import type {StoragePort} from '../../ports/storage.js';
import type {Deadline} from '../../ports/clock.js';
import {ENVIRONMENT_READ_METHODS} from '../../protocol/environment.js';
import {createEnvironmentDispatch,type EnvironmentRpcAction} from './dispatch.js';

export interface EnvironmentRuntimeContext {
 accepting():boolean;
 schedule(work:()=>Promise<void>):void;
}
export interface EnvironmentRuntimeServices {
 readonly actions:Readonly<Record<string,EnvironmentRpcAction>>;
 recover?():Promise<void>;
 stop?():void;
}

export function createEnvironmentRuntime(options:{storage:StoragePort;instanceId:string;
 compose?:(runtime:EnvironmentRuntimeContext)=>EnvironmentRuntimeServices}){
 const {storage,instanceId}=options;
 let accepting=false;
 const jobs=new Set<Promise<void>>();
 function schedule(work:()=>Promise<void>){
   const job=Promise.resolve().then(work);
   jobs.add(job);
   void job.finally(()=>jobs.delete(job)).catch(()=>{});
 }
 const service=options.compose?.({accepting:()=>accepting,schedule});
 const actions:Record<string,EnvironmentRpcAction>={};
 for(const [method,action] of Object.entries(service?.actions??{})){
   actions[method]=async(params,peer)=>{
     if(!accepting)throw new Error('BLOCKED');
     return action(params,peer);
   };
 }
 return{
   methods:[...new Set([...ENVIRONMENT_READ_METHODS,...Object.keys(actions)])],
   dispatch:createEnvironmentDispatch({storage,actions}),
   fence(){accepting=false;},
   async recover(){
     accepting=false;
     if(((await storage.readSnapshot())?.store.schemaVersion??0)<7)return;
     const {operations}=await storage.readEnvironmentState!({kind:'pending-plans'});
     for(const operation of operations??[])await storage.commitEnvironmentState!({kind:'plan-block',instanceId,
       requestId:operation.requestId,error:'INTERRUPTED',interrupted:true});
     await service?.recover?.();
     accepting=true;
   },
   async idle(){while(jobs.size)await Promise.all([...jobs]);},
   async stop(deadline:Deadline){
     accepting=false;service?.stop?.();
     if(!jobs.size)return;
     let timer:ReturnType<typeof setTimeout>|undefined;
     try{
       await Promise.race([Promise.all([...jobs]),new Promise<never>((_,reject)=>{
         timer=setTimeout(()=>reject(new Error('JOB_RECONCILING')),Math.max(1,deadline.remainingMs()));
       })]);
     }finally{clearTimeout(timer);}
   },
 };
}
