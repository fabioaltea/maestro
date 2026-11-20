import type {SchedulerJob} from '../../ports/scheduler.js';

export interface QueueCursor {
 readonly lastProject:string|null;
 readonly streaks:ReadonlyMap<string,{readonly priority:number;readonly count:number}>;
}
export function schedulerEligible(job:SchedulerJob,nowMs:number){
 return ['QUEUED','WAITING_RESOURCE','WAITING_PROVIDER'].includes(job.state)&&
   (job.notBefore===null||Number.isFinite(Date.parse(job.notBefore))&&Date.parse(job.notBefore)<=nowMs);
}
export function chooseSchedulerJob(jobs:readonly SchedulerJob[],cursor:QueueCursor,nowMs:number,canRun:(job:SchedulerJob)=>boolean){
 const eligible=jobs.filter(job=>schedulerEligible(job,nowMs)&&canRun(job));
 const projects=[...new Set(eligible.map(job=>job.projectId))].sort();
 if(!projects.length)return null;
 const last=cursor.lastProject;
 const project=(last===null?undefined:projects.find(project=>project>last))??projects[0];
 const order=(a:SchedulerJob,b:SchedulerJob)=>a.queuedAt.localeCompare(b.queuedAt)||a.jobId.localeCompare(b.jobId);
 const jobsInProject=eligible.filter(job=>job.projectId===project).sort((a,b)=>a.priority-b.priority||order(a,b));
 const first=jobsInProject[0]!;
 const streak=cursor.streaks.get(first.projectId);
 if(streak?.priority===first.priority&&streak.count>=4){
   const next=jobsInProject.filter(job=>job.priority>first.priority).sort(order)[0];
   if(next)return next;
 }
 return first;
}
export function schedulerPriority(value:unknown):number{
 if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0||value>2)throw new Error('INVALID_REQUEST');
 return value;
}
export function schedulerDate(value:unknown):string{
 if(typeof value!=='string'||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/.test(value)||
    !Number.isFinite(Date.parse(value))||new Date(value).toISOString()!==value)throw new Error('INVALID_REQUEST');
 return value;
}
