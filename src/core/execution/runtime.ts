import type {ArchivePaths,AuthenticatedPeer} from '../../ports/platform.js';
import type {StoragePort} from '../../ports/storage.js';
import type {Deadline} from '../../ports/clock.js';
import type {DiscoveryEligibility} from '../../domain/discovery/approval.js';
import type {ExecutionProviderPort} from '../../ports/execution-provider.js';
import type {ExecutionRuntimePort} from '../../ports/execution-runtime.js';
import type {WorkspaceLease,WorkspaceLeaseRequest,WorkspaceReleaseProof} from '../../ports/workspace.js';
import {EXECUTION_READ_METHODS} from '../../protocol/execution.js';
import {createExecutionDispatch,type ExecutionAction} from './dispatch.js';
import {createExecutionServices} from './start.js';

export interface ExecutionLeasePort {
 acquire(request:WorkspaceLeaseRequest):Promise<WorkspaceLease>;
 release(lease:WorkspaceLease,proof:WorkspaceReleaseProof):Promise<WorkspaceLease>;
}
export interface ExecutionDependencies {
 readonly provider:ExecutionProviderPort;
 readonly host?:ExecutionRuntimePort;
}
export interface ExecutionContext {
 readonly storage:StoragePort;readonly paths:ArchivePaths;readonly instanceId:string;readonly lease?:ExecutionLeasePort;
 readonly currentEligibility:(peer:AuthenticatedPeer,projectId:string)=>Promise<DiscoveryEligibility>;
 readonly dependencies?:ExecutionDependencies;
 accepting():boolean;
 schedule(work:()=>Promise<void>):void;
}

export function createExecutionRuntime(options:Omit<ExecutionContext,'accepting'|'schedule'>){
 const {storage}=options;
 let accepting=false;
 const pending=new Set<Promise<unknown>>();
 function track<T>(job:Promise<T>){
   pending.add(job);
   void job.finally(()=>pending.delete(job)).catch(()=>{});
   return job;
 }
 const service=createExecutionServices({...options,accepting:()=>accepting,schedule:work=>{track(Promise.resolve().then(work));}});
 const actions:Record<string,ExecutionAction>={};
 for(const [method,action] of Object.entries(service.actions)){
   actions[method]=async(params,peer)=>{
     if(!accepting)throw new Error('BLOCKED');
     if(pending.size>=8&&!['execution.cancel','execution.reconcile'].includes(method))throw new Error('BUSY');
     return track(action(params,peer));
   };
 }
 return{
   methods:[...EXECUTION_READ_METHODS,...Object.keys(actions)],
   dispatch:createExecutionDispatch(storage,actions),
   fence(){accepting=false;},
   async recover(){
     if(((await storage.readSnapshot())?.store.schemaVersion??0)<9||!storage.readExecutionState)return;
     await service.recover();accepting=true;
   },
   async idle(){while(pending.size)await Promise.allSettled([...pending]);},
   async stop(deadline:Deadline){
     accepting=false;
     service.stop();
     let timer:ReturnType<typeof setTimeout>|undefined;
     try{
       await Promise.race([
         (async()=>{while(pending.size){service.stop();await Promise.allSettled([...pending]);}})(),
         new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('PROCESS_UNKNOWN')),Math.max(1,deadline.remainingMs()));}),
       ]);
     }finally{clearTimeout(timer);}
   },
 };
}
