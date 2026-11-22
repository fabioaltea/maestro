import {randomUUID} from 'node:crypto';
import type {StoragePort} from '../../ports/storage.js';
import type {ArchivePaths} from '../../ports/platform.js';
import {systemClock,type Clock,type Deadline} from '../../ports/clock.js';
import type {SchedulerExecutor,SchedulerJob} from '../../ports/scheduler.js';
import {SCHEDULER_READ_METHODS} from '../../protocol/scheduler.js';
import {chooseSchedulerJob,type QueueCursor} from '../../domain/scheduler/queue.js';
import {classifyError} from '../control-main.js';
import {createSchedulerAdmission} from './admission.js';
import {createSchedulerDispatch} from './dispatch.js';

export function createSchedulerRuntime(options:{storage:StoragePort;paths:ArchivePaths;instanceId:string;executor?:SchedulerExecutor;clock?:Clock}){
 const {storage,instanceId,executor}=options,clock=options.clock??systemClock;
 let accepting=false,pumping:Promise<void>|null=null,wanted=false;
 let timer:ReturnType<typeof setTimeout>|undefined;
 const workers=new Map<string,{task:Promise<void>;stop():void}>();
 const streaks=new Map<string,{priority:number;count:number}>();
 let lastProject:QueueCursor['lastProject']=null;
 const query=storage.readSchedulerState!,commit=storage.commitSchedulerState!;
 async function pageAll(){
   const jobs:SchedulerJob[]=[];
   // Eligible waiting jobs are bounded by admission. Scan pages without
   // retaining terminal history or creating a periodic monitor.
   let offset=0;
   do{
     const page=await query({kind:'pending',offset});
     jobs.push(...(page.jobs??[]));offset=page.nextOffset??0;
   }while(offset>0);
   return jobs;
 }
 async function pump(){
   if(!executor)return;
   const skipped=new Set<string>();
   clearTimeout(timer);timer=undefined;
   while(accepting){
     const jobs=await pageAll(),at=clock.wallUtc(),now=Date.parse(at);
     const j=chooseSchedulerJob(jobs,{lastProject,streaks},now,item=>!skipped.has(item.jobId));
     if(!j){
       const next=jobs.filter(job=>job.notBefore!==null).map(job=>Date.parse(job.notBefore!)).filter(time=>time>now).sort((a,b)=>a-b)[0];
       if(next!==undefined&&accepting){timer=setTimeout(wake,Math.min(next-now,2_147_483_647));timer.unref();}
       return;
     }
     const generation=randomUUID();
     try{
       const result=await commit({kind:'reserve',instanceId,expectedRevision:j.stateRevision,at,
         resource:{jobId:j.jobId,generation,projectId:j.projectId,type:j.type,workspaceId:j.workspaceId}});
       if(!result.reservation)throw new Error('STATE_CORRUPT');
       const reservation=result.reservation;
       const streak=streaks.get(j.projectId);
       streaks.set(j.projectId,{priority:j.priority,count:streak?.priority===j.priority?Math.min(4,streak.count+1):1});
       lastProject=j.projectId;
       let stop=()=>{};
       const task=(async()=>{
         try{
           const host=await executor.open(j,reservation);
           stop=()=>host.stop();
           if(!accepting){stop();throw new Error('INTERRUPTED');}
           await commit({kind:'reservation',instanceId,jobId:j.jobId,generation,event:{kind:'go',generation}});
           if(!accepting){stop();throw new Error('INTERRUPTED');}
           const {proof,success}=await host.go();
           await commit({kind:'reservation',instanceId,jobId:j.jobId,generation,event:{kind:'release',proof},success});
         }catch{
           stop();
           await commit({kind:'reservation',instanceId,jobId:j.jobId,generation,event:{kind:'owner-lost'}});
         }
       })();
       workers.set(j.jobId,{task,stop:()=>stop()});
       void task.finally(()=>{workers.delete(j.jobId);wake();}).catch(()=>{});
     }catch(error){
       const code=classifyError(error);
       if(!['RESOURCE_WAIT','WORKSPACE_IN_USE','STALE_TARGET','APPROVAL_STALE','RETRY_EXHAUSTED'].includes(code))throw error;
       skipped.add(j.jobId);
     }
   }
 }
 function wake(){
   if(!accepting||!executor)return;
   wanted=true;
   if(pumping)return;
   pumping=(async()=>{while(wanted&&accepting){wanted=false;await pump();}})();
   void pumping.finally(()=>{pumping=null;if(wanted)wake();}).catch(()=>{});
 }
 const actions=storage.commitSchedulerState&&storage.readSchedulerState?
   createSchedulerAdmission({...options,accepting:()=>accepting,wake}):{};
 return{
   methods:[...SCHEDULER_READ_METHODS,...Object.keys(actions)],
   dispatch:createSchedulerDispatch(storage,actions,executor!==undefined),
   async recover(){
     if(((await storage.readSnapshot())?.store.schemaVersion??0)<10||!commit)return;
     await commit({kind:'recover',instanceId});accepting=true;wake();
   },
   fence(){accepting=false;clearTimeout(timer);},
   async stop(deadline:Deadline){
     accepting=false;clearTimeout(timer);
     for(const worker of workers.values())worker.stop();
     const pending=[...Array.from(workers.values(),worker=>worker.task),...(pumping?[pumping]:[])];
     if(!pending.length)return;
     let limit:ReturnType<typeof setTimeout>|undefined;
     try{
       await Promise.race([Promise.allSettled(pending),new Promise<never>((_,reject)=>{
         limit=setTimeout(()=>reject(new Error('RESERVATION_UNKNOWN')),Math.max(1,deadline.remainingMs()));
       })]);
     }finally{clearTimeout(limit);}
   },
 };
}
