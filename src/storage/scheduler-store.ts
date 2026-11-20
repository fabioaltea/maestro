import type Database from 'better-sqlite3';
import {requireUuid} from '../domain/identifiers.js';
import {admissionBlock,reserveSchedulerResource,SCHEDULER_PENDING_LIMIT,schedulerReservationTransition,validateSchedulerLimits} from '../domain/scheduler/resource-admission.js';
import {schedulerDate,schedulerEligible,schedulerPriority} from '../domain/scheduler/queue.js';
import type {SchedulerChange,SchedulerJob,SchedulerLimits,SchedulerQuery,SchedulerRead,SchedulerReservation,SchedulerWrite} from '../ports/scheduler.js';
import {readFeatureState,type FeatureRow} from './features-store.js';
import type {createWorkflowStore} from './workflow-store.js';
import {SCHEDULER_SCHEMA_VERSION} from './scheduler-schema.js';

const final=['CANCELLED','SUCCEEDED','FAILED'];
const nullable=(value:unknown)=>value===null?null:String(value);
function schema(db:Database.Database){
 if(Number(db.pragma('user_version',{simple:true}))<SCHEDULER_SCHEMA_VERSION)throw new Error('SCHEDULER_NOT_INITIALIZED');
}
function job(r:FeatureRow):SchedulerJob{
 return{jobId:String(r.job_id),intentId:String(r.intent_id),projectId:String(r.project_id),workspaceId:nullable(r.workspace_id),
   sessionId:nullable(r.session_id),type:r.type as SchedulerJob['type'],priority:Number(r.priority),queuedAt:String(r.queued_at),
   notBefore:nullable(r.not_before),state:r.state as SchedulerJob['state'],stateRevision:String(r.state_revision),reason:nullable(r.reason),attempts:Number(r.attempts)};
}
function reservation(r:FeatureRow):SchedulerReservation{
 return{jobId:String(r.job_id),generation:String(r.generation),projectId:String(r.project_id),workspaceId:nullable(r.workspace_id),
   type:r.type as SchedulerJob['type'],state:r.state as SchedulerReservation['state'],goAuthorized:r.go_authorized===1};
}
function active(db:Database.Database){
 return (db.prepare(`SELECT r.*,j.project_id,j.type FROM scheduler_reservations r JOIN scheduler_jobs j USING(job_id)
   WHERE r.state<>'RELEASED' ORDER BY j.queued_at,r.job_id`).all() as FeatureRow[]).map(reservation);
}
export function readSchedulerState(db:Database.Database,q:SchedulerQuery):SchedulerRead{
 schema(db);
 switch(q.kind){
   case 'policy':{
     const row=db.prepare('SELECT * FROM scheduler_policy ORDER BY revision DESC LIMIT 1').get() as FeatureRow;
     return{policy:{revision:String(row.revision),limits:{global:Number(row.global_limit),install:Number(row.install_limit),validate:Number(row.validate_limit)}}};
   }
   case 'job':{
     const row=db.prepare('SELECT * FROM scheduler_jobs WHERE job_id=?').get(requireUuid(q.id)) as FeatureRow|undefined;
     return{job:row?job(row):null};
   }
   case 'reservations':return{reservations:active(db)};
   case 'queue':{
     const projectId=q.projectId===null?null:requireUuid(q.projectId),offset=q.offset??0,limit=q.limit??20;
     if(!Number.isSafeInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>20)throw new Error('INVALID_REQUEST');
     const rows=db.prepare(`SELECT * FROM scheduler_jobs WHERE (? IS NULL OR project_id=?) ORDER BY queued_at DESC,job_id DESC LIMIT ? OFFSET ?`)
       .all(projectId,projectId,limit+1,offset) as FeatureRow[];
     const version=db.prepare('SELECT count(*) AS count,COALESCE(SUM(state_revision),0) AS revision FROM scheduler_jobs WHERE (? IS NULL OR project_id=?)')
       .get(projectId,projectId) as FeatureRow;
     return{jobs:rows.slice(0,limit).map(job),reservations:active(db).filter(r=>projectId===null||r.projectId===projectId),
       revision:`${version.count}:${version.revision}`,nextOffset:rows.length>limit?offset+limit:null};
   }
 }
}

function inheritedReservations(db:Database.Database):SchedulerReservation[]{
 const rows=db.prepare(`SELECT r.run_id AS job_id,r.generation,d.project_id,NULL AS workspace_id,'DISCOVERY' AS type
    FROM discovery_runs r JOIN discoveries d USING(discovery_id) WHERE r.phase<>'FINALIZED'
    UNION ALL SELECT t.run_id,t.generation,f.project_id,NULL,'EXECUTION'
    FROM features_turns t JOIN features_records f USING(feature_id) WHERE t.phase IN ('ACCEPTED','RUNNING','RECONCILING')
    UNION ALL SELECT r.run_id,r.generation,s.project_id,s.workspace_id,'EXECUTION'
    FROM execution_runs r JOIN execution_sessions s USING(session_id) WHERE r.phase<>'FINALIZED'
    UNION ALL SELECT j.job_id,j.generation,w.project_id,w.workspace_id,j.kind
    FROM environments_jobs j JOIN environments_records e USING(environment_id) JOIN workspaces_records w USING(workspace_id)
    WHERE j.phase IN ('QUEUED','RUNNING','CANCELLING','RECONCILING')`).all() as FeatureRow[];
 return rows.map(row=>reservation({...row,state:'RUNNING',go_authorized:1}));
}

export function commitSchedulerState(db:Database.Database,c:SchedulerChange,ledger:ReturnType<typeof createWorkflowStore>,now=Date.now):SchedulerWrite{
 schema(db);
 const read=(q:SchedulerQuery)=>readSchedulerState(db,q);
 function find(id:string){
   const value=read({kind:'job',id}).job;
   if(!value)throw new Error('OPERATION_NOT_FOUND');
   return value;
 }
 function update(j:SchedulerJob,state:SchedulerJob['state'],reason:string|null,attempts=j.attempts){
   const r=db.prepare('UPDATE scheduler_jobs SET state=?,reason=?,attempts=?,state_revision=state_revision+1 WHERE job_id=? AND state_revision=?')
     .run(state,reason,attempts,j.jobId,BigInt(j.stateRevision));
   if(r.changes!==1)throw new Error('STALE_TARGET');
 }
 function approvedIntent(id:string,at:number){
   const grant=readFeatureState(db,{kind:'grant',id:requireUuid(id)}).grant;
   if(!grant||grant.consumedByRequestId!==null||at<grant.createdAtMs||at>=grant.expiresAtMs)throw new Error('APPROVAL_STALE');
   return ledger.intent(grant.canonicalIntent);
 }
 if('admission' in c){
   const a=c.admission,i=ledger.intent(a.canonicalIntent);
   if(i.namespace!=='SCHEDULER'||i.action!==c.kind)throw new Error('INVALID_REQUEST');
   return ledger.admit(a,()=>{
     if(c.kind==='policy.configure'){
       const policy=read({kind:'policy'}).policy!;
       if(i.targetId!==null||i.expectedRevision!==policy.revision)throw new Error('APPROVAL_STALE');
       const limits=i.payload.limits as SchedulerLimits;
       validateSchedulerLimits(limits);
       const revision=BigInt(policy.revision)+1n;
       db.prepare('INSERT INTO scheduler_policy VALUES(?,?,?,?,?)').run(revision,a.requestId,limits.global,limits.install,limits.validate);
       ledger.complete(a.requestId,{policyRevision:String(revision)});
       return;
     }
     if(c.kind==='enqueue'){
       const intentId=requireUuid(i.payload.jobIntentId),original=approvedIntent(intentId,now());
       const projectId=requireUuid(original.projectId);
       let type:SchedulerJob['type'],workspaceId:string,sessionId:string|null=null;
       if(original.namespace==='EXECUTION'&&['start','resume'].includes(original.action)){
         type='EXECUTION';workspaceId=requireUuid(original.payload.workspaceId);
         if(original.action==='resume')sessionId=requireUuid(original.targetId);
       }else if(original.namespace==='ENVIRONMENT'&&['prepare','validate'].includes(original.action)){
         type=original.action==='prepare'?'INSTALL':'VALIDATE';workspaceId=requireUuid(original.targetId);
       }else throw new Error('APPROVAL_REQUIRED');
       if(i.targetId!==intentId||i.projectId!==projectId)throw new Error('APPROVAL_REQUIRED');
       if(!db.prepare(`SELECT 1 FROM projects p JOIN workspaces_records w USING(project_id)
          WHERE p.project_id=? AND p.removed_at IS NULL AND w.workspace_id=? AND w.state<>'REMOVED'`).get(projectId,workspaceId))
         throw new Error('WORKSPACE_NOT_FOUND');
       if(db.prepare("SELECT 1 FROM scheduler_jobs WHERE intent_id=? AND state NOT IN ('CANCELLED','SUCCEEDED','FAILED')").get(intentId))
         throw new Error('IDEMPOTENCY_CONFLICT');
       const queued=db.prepare(`SELECT count(*) AS pending FROM scheduler_jobs
          WHERE state IN ('QUEUED','WAITING_RESOURCE','WAITING_PROVIDER','WAITING_USER','PAUSED')`).get() as FeatureRow;
       if(Number(queued.pending)>=SCHEDULER_PENDING_LIMIT)throw new Error('QUEUE_FULL');
       const notBefore=i.payload.notBefore==null?null:schedulerDate(i.payload.notBefore);
       db.prepare(`INSERT INTO scheduler_jobs(job_id,intent_id,project_id,workspace_id,session_id,type,priority,queued_at,not_before,state,state_revision,reason)
          VALUES(?,?,?,?,?,?,?,?,?,'QUEUED',1,NULL)`).run(a.requestId,intentId,projectId,workspaceId,sessionId,type,schedulerPriority(i.payload.priority),
          new Date(now()).toISOString(),notBefore);
       ledger.complete(a.requestId,{jobId:a.requestId,stateRevision:'1',position:Number(queued.pending)+1});
       return;
     }
     const j=find(requireUuid(i.targetId));
     if(j.projectId!==i.projectId||j.stateRevision!==i.expectedRevision||final.includes(j.state))throw new Error('APPROVAL_STALE');
     const hasReservation=active(db).some(r=>r.jobId===j.jobId);
     if(hasReservation||j.state==='RECONCILING')throw new Error('RESERVATION_UNKNOWN');
     update(j,c.kind==='pause'?'PAUSED':'CANCELLED',null);
     ledger.complete(a.requestId,{jobId:j.jobId,stateRevision:String(BigInt(j.stateRevision)+1n)});
   });
 }
 const owner=db.prepare('SELECT current_instance_id FROM store WHERE singleton=1').get() as FeatureRow;
 if(owner.current_instance_id!==requireUuid(c.instanceId))throw new Error('STALE_TARGET');
 if(c.kind==='recover'){
   ledger.transaction(()=>{
     const old=(db.prepare("SELECT generation,job_id FROM scheduler_reservations WHERE instance_id<>? AND state IN ('RESERVED','RUNNING')")
       .all(c.instanceId) as FeatureRow[]);
     for(const row of old){
       db.prepare("UPDATE scheduler_reservations SET state='RECONCILING' WHERE generation=?").run(row.generation);
       update(find(String(row.job_id)),'RECONCILING','RESERVATION_UNKNOWN');
     }
   },true);
   return{};
 }
 if(c.kind==='reserve'){
   const job=find(c.resource.jobId),r=reserveSchedulerResource(c.resource);
   return ledger.transaction(()=>{
     if(job.stateRevision!==c.expectedRevision||!schedulerEligible(job,Date.parse(schedulerDate(c.at)))||job.type!==r.type||
        job.projectId!==r.projectId||job.workspaceId!==r.workspaceId)throw new Error('STALE_TARGET');
     if(job.attempts>=3)throw new Error('RETRY_EXHAUSTED');
     approvedIntent(job.intentId,Date.parse(c.at));
     if(db.prepare('SELECT 1 FROM scheduler_reservations WHERE generation=?').get(r.generation))throw new Error('STALE_TARGET');
     const block=admissionBlock(read({kind:'policy'}).policy!.limits,[...active(db),...inheritedReservations(db)],r);
     if(block==='WORKSPACE_IN_USE'||r.workspaceId!==null&&db.prepare(
       'SELECT 1 FROM workspaces_leases WHERE workspace_id=? AND released_at IS NULL').get(r.workspaceId))
       throw new Error('WORKSPACE_IN_USE');
     if(block)throw new Error('RESOURCE_WAIT');
     db.prepare("INSERT INTO scheduler_reservations VALUES(?,?,?,?,'RESERVED',0,NULL)").run(r.generation,r.jobId,r.workspaceId,c.instanceId);
     update(job,'RESERVED',null);
     return{reservation:r,job:find(job.jobId)};
   });
 }
 const job=find(c.jobId),previous=active(db).find(r=>r.generation===c.generation&&r.jobId===c.jobId);
 if(!previous)throw new Error('STALE_TARGET');
 return ledger.transaction(()=>{
   const next=schedulerReservationTransition(previous,c.event),released=c.event.kind==='release';
   const instance=db.prepare('SELECT instance_id FROM scheduler_reservations WHERE generation=?').get(c.generation) as FeatureRow;
   if(instance.instance_id!==c.instanceId&&!released)throw new Error('STALE_TARGET');
   db.prepare('UPDATE scheduler_reservations SET state=?,go_authorized=?,proof=? WHERE generation=?')
     .run(next.state,next.goAuthorized?1:0,c.event.kind==='release'?JSON.stringify(c.event.proof):null,next.generation);
   if(c.event.kind==='go')update(job,'RUNNING',null,job.attempts+1);
   else if(c.event.kind==='owner-lost')update(job,'RECONCILING','RESERVATION_UNKNOWN');
   else update(job,c.success?'SUCCEEDED':c.event.proof.kind==='NO_SPAWN'?'WAITING_USER':'FAILED',c.success?null:'INTERRUPTED');
   return{reservation:next,job:find(job.jobId)};
 },true);
}
