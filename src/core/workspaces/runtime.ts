import type {StoragePort} from '../../ports/storage.js';
import type {Deadline} from '../../ports/clock.js';
import type {AuthenticatedPeer} from '../../ports/platform.js';
import {WORKSPACE_READ_METHODS} from '../../protocol/workspace.js';
import {createWorkspaceDispatch} from './dispatch.js';

type Action=(params:Readonly<Record<string,unknown>>,peer:AuthenticatedPeer)=>Promise<Record<string,unknown>>;
export interface WorkspaceRuntimeServices {
 readonly actions:Readonly<Record<string,Action>>;
 recover():Promise<void>;
}
export interface WorkspaceRuntimeContext {
 accepting():boolean;
 schedule(job:()=>Promise<void>):void;
}

/** A single daemon-owned queue. Disconnection cannot cancel accepted mutations. */
export function createWorkspaceRuntime(storage:StoragePort,
 compose?:(runtime:WorkspaceRuntimeContext)=>WorkspaceRuntimeServices){
 let accepting=false;
 const jobs=new Set<Promise<void>>();
 function schedule(work:()=>Promise<void>){
   const job=Promise.resolve().then(work);
   jobs.add(job);
   void job.finally(()=>jobs.delete(job)).catch(()=>{});
 }
 const service=compose?.({accepting:()=>accepting,schedule});
 const actions:Record<string,Action>={};
 for(const [method,action] of Object.entries(service?.actions??{})){
   actions[method]=async(params,peer)=>{
     if(!accepting)throw new Error('BLOCKED');
     return action(params,peer);
   };
 }
 const methods=[...new Set([...WORKSPACE_READ_METHODS,...Object.keys(actions)])];
 return{
   methods,
   dispatch:createWorkspaceDispatch({storage,composed:actions}),
   fence(){accepting=false;},
   async recover(){
     accepting=false;
     if(((await storage.readSnapshot())?.store.schemaVersion??0)<6)return;
     await service?.recover();
     accepting=true;
   },
   async idle(){while(jobs.size)await Promise.all([...jobs]);},
   async stop(deadline:Deadline){
     accepting=false;
     if(!jobs.size)return;
     let timer:ReturnType<typeof setTimeout>|undefined;
     try{
       await Promise.race([Promise.all([...jobs]),new Promise<never>((_resolve,reject)=>{
         timer=setTimeout(()=>reject(new Error('RESOURCE_IDENTITY_UNKNOWN')),Math.max(1,deadline.remainingMs()));
       })]);
     }finally{clearTimeout(timer);}
   },
 };
}
