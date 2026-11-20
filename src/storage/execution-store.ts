import type Database from 'better-sqlite3';
import {requireDecimal,requireUuid} from '../domain/identifiers.js';
import {EXECUTION_LIMITS,executionCompletion,executionTransition,requireExecutionIdentity} from '../domain/execution/model.js';
import type {ExecutionChange,ExecutionCheckpoint,ExecutionInteraction,ExecutionOutput,ExecutionProviderConfig,ExecutionQuery,ExecutionRead,ExecutionRun,ExecutionSession,ExecutionStoragePort} from '../ports/execution.js';
import type {WorkflowArtifact} from '../ports/workflow.js';
import {readFeatureState,type FeatureRow} from './features-store.js';
import type {createWorkflowStore} from './workflow-store.js';
import {EXECUTION_SCHEMA_VERSION} from './execution-schema.js';

const s=(value:unknown)=>String(value);
const nullable=(value:unknown)=>value===null?null:s(value);
const json=<T>(value:unknown):T=>JSON.parse(s(value)) as T;
const provider=(row:FeatureRow):ExecutionProviderConfig=>({...json<ExecutionProviderConfig>(row.metadata),providerId:row.provider_id as ExecutionProviderConfig['providerId'],configRevision:s(row.config_revision)});
const session=(row:FeatureRow):ExecutionSession=>({
 sessionId:s(row.session_id),featureId:s(row.feature_id),workspaceId:s(row.workspace_id),projectId:s(row.project_id),
 profileResolutionId:s(row.profile_resolution_id),envelopeId:s(row.envelope_id),state:row.state as ExecutionSession['state'],
 stateRevision:s(row.state_revision),runId:s(row.run_id),checkpointId:nullable(row.checkpoint_id),createdAt:s(row.created_at),updatedAt:s(row.updated_at),
});
const run=(row:FeatureRow):ExecutionRun=>({
 runId:s(row.run_id),sessionId:s(row.session_id),generation:s(row.generation),instanceId:s(row.instance_id),
 providerId:row.provider_id as ExecutionRun['providerId'],configRevision:s(row.config_revision),capabilityDigest:s(row.capability_digest),
 inputDigest:s(row.input_digest),phase:row.phase as ExecutionRun['phase'],outcome:row.outcome as ExecutionRun['outcome'],
 identity:json(row.identity),proof:json(row.proof),requested:row.requested as ExecutionRun['requested'],controlRequestId:nullable(row.control_request_id),
 outputWatermark:s(row.output_watermark),truncated:Number(row.truncated)===1,
});
const checkpoint=(row:FeatureRow):ExecutionCheckpoint=>({
 checkpointId:s(row.checkpoint_id),sessionId:s(row.session_id),runId:s(row.run_id),inputDigest:s(row.input_digest),
 treeDigest:s(row.tree_digest),patchArtifactId:s(row.patch_artifact_id),digest:s(row.digest),createdAt:s(row.created_at),
});
const interaction=(row:FeatureRow):ExecutionInteraction=>({
 interactionId:s(row.interaction_id),runId:s(row.run_id),generation:s(row.generation),expectedRevision:s(row.expected_revision),
 textArtifactId:s(row.text_artifact_id),type:row.type as ExecutionInteraction['type'],status:row.status as ExecutionInteraction['status'],
 answerArtifactId:nullable(row.answer_artifact_id),
});
const output=(row:FeatureRow):ExecutionOutput=>({seq:s(row.seq),artifactId:s(row.artifact_id),sha256:s(row.sha256),bytes:Number(row.bytes)});
function schema(db:Database.Database){
 if(Number(db.pragma('user_version',{simple:true}))<EXECUTION_SCHEMA_VERSION)throw new Error('EXECUTION_NOT_INITIALIZED');
}
export function readExecutionState(db:Database.Database,query:ExecutionQuery):ExecutionRead{
 schema(db);
 const row=<T>(sql:string,map:(data:FeatureRow)=>T,value?:string)=>{
   const data=db.prepare(sql).get(...(value===undefined?[]:[value])) as FeatureRow|undefined;
   return data?map(data):null;
 };
 switch(query.kind){
   case 'provider':return{provider:row('SELECT * FROM execution_providers WHERE provider_id=?',provider,query.id)};
   case 'session':return{session:row('SELECT * FROM execution_sessions WHERE session_id=?',session,requireUuid(query.id))};
   case 'run':return{run:row('SELECT * FROM execution_runs WHERE run_id=?',run,requireUuid(query.id))};
   case 'active':return{run:row("SELECT * FROM execution_runs WHERE phase<>'FINALIZED'",run)};
   case 'retained-leases':return{runs:(db.prepare(`SELECT r.* FROM execution_runs r JOIN workspaces_leases l ON l.holder_id=r.run_id AND l.generation=r.generation
      WHERE l.holder_type='RUN' AND l.released_at IS NULL AND r.phase='FINALIZED'`).all() as FeatureRow[]).map(run)};
   case 'checkpoint':return{checkpoint:row('SELECT * FROM execution_checkpoints WHERE checkpoint_id=?',checkpoint,requireUuid(query.id))};
   case 'interaction':return{interaction:row('SELECT * FROM execution_interactions WHERE interaction_id=?',interaction,requireUuid(query.id))};
   case 'interactions':return{interactions:(db.prepare('SELECT * FROM execution_interactions WHERE run_id=? ORDER BY expected_revision').all(requireUuid(query.id)) as FeatureRow[]).map(interaction)};
   case 'artifact':{
     const id=requireUuid(query.id);
     const data=db.prepare(`SELECT a.sha256,a.expected_bytes FROM workflow_artifacts a
       WHERE a.artifact_id=? AND a.state='REFERENCED' AND (
       EXISTS(SELECT 1 FROM execution_output WHERE artifact_id=a.artifact_id)
       OR EXISTS(SELECT 1 FROM execution_checkpoints WHERE patch_artifact_id=a.artifact_id)
       OR EXISTS(SELECT 1 FROM execution_interactions WHERE text_artifact_id=a.artifact_id OR answer_artifact_id=a.artifact_id)
       )`).get(id) as FeatureRow|undefined;
     return{artifact:data?{sha256:s(data.sha256),bytes:Number(data.expected_bytes)}:null};
   }
   case 'output':{
     const id=requireUuid(query.id),current=readExecutionState(db,{kind:'run',id}).run;
     if(!current)throw new Error('OPERATION_NOT_FOUND');
     const limit=Math.max(1,Math.min(query.limit??20,20));
     const rows=db.prepare('SELECT * FROM execution_output WHERE run_id=? AND seq>? ORDER BY seq LIMIT ?')
       .all(id,BigInt(requireDecimal(query.after??'0')),limit) as FeatureRow[];
     return{run:current,output:rows.map(output),revision:current.outputWatermark};
   }
   case 'sessions':{
     const id=requireUuid(query.projectId),offset=query.offset??0,limit=Math.max(1,Math.min(query.limit??20,20));
     const rows=db.prepare('SELECT * FROM execution_sessions WHERE project_id=? ORDER BY created_at DESC,session_id DESC LIMIT ? OFFSET ?').all(id,limit+1,offset) as FeatureRow[];
     const meta=db.prepare('SELECT COUNT(*) AS count,COALESCE(SUM(state_revision),0) AS revision FROM execution_sessions WHERE project_id=?').get(id) as FeatureRow;
     return{sessions:rows.slice(0,limit).map(session),nextOffset:rows.length>limit?offset+limit:null,revision:`${s(meta.count)}:${s(meta.revision)}`};
   }
 }
}

export function commitExecutionState(db:Database.Database,c:ExecutionChange,ledger:ReturnType<typeof createWorkflowStore>,verifyArtifact:(id:string)=>void):
 Awaited<ReturnType<NonNullable<ExecutionStoragePort['commitExecutionState']>>>{
 schema(db);
 const read=(q:ExecutionQuery)=>readExecutionState(db,q);
 const now=()=>new Date().toISOString();
 const initial=c.kind==='begin'?c.run.runId:'runId' in c?c.runId:null;
 const result=(requestId:string,executionRun?:ExecutionRun|null,executionSession?:ExecutionSession|null,inserted?:boolean)=>{
   const operation=ledger.operation(requestId);
   if(!operation)throw new Error('OPERATION_NOT_FOUND');
   return{operation,...(executionRun?{run:executionRun}:{}),...(executionSession?{session:executionSession}:{}),...(inserted===undefined?{}:{inserted})};
 };
 function updateState(value:ExecutionSession,state:ExecutionSession['state']){
   const update=db.prepare('UPDATE execution_sessions SET state=?,state_revision=state_revision+1,updated_at=? WHERE session_id=? AND state_revision=?')
     .run(state,now(),value.sessionId,BigInt(value.stateRevision));
   if(update.changes!==1)throw new Error('EXECUTION_APPROVAL_STALE');
 }
 function artifact(id:string,kind:WorkflowArtifact['kind'],targetId:string,maximum:number){
   const value=readFeatureState(db,{kind:'artifact',id:requireUuid(id)}).artifact;
   if(!value||value.kind!==kind||value.targetId!==targetId||value.expectedBytes>maximum||!['SEALED','REFERENCED'].includes(value.state))
     throw new Error('ARTIFACT_CORRUPT');
   verifyArtifact(id);
   db.prepare("UPDATE workflow_artifacts SET state='REFERENCED',ref_count=ref_count+1 WHERE artifact_id=?").run(id);
   return value;
 }
 function checkTuple(e:ExecutionSession,r:ExecutionRun,i:ReturnType<typeof ledger.intent>,leased:boolean){
   const p=i.payload,config=read({kind:'provider',id:r.providerId}).provider;
   if(!config||config.configRevision!==r.configRevision||config.capabilityDigest!==r.capabilityDigest||config.status!=='QUALIFIED')
     throw new Error('EXECUTION_APPROVAL_STALE');
   const target=db.prepare(`SELECT 1 FROM workspaces_records w JOIN features_records f ON f.feature_id=w.feature_id
     JOIN projects p ON p.project_id=w.project_id JOIN profiles_resolutions pr ON pr.resolution_id=?
     JOIN features_envelopes v ON v.envelope_id=w.envelope_id
     JOIN discovery_approvals a ON a.approval_id=v.discovery_approval_id
     JOIN discoveries d ON d.discovery_id=a.discovery_id
     JOIN environments_records n ON n.workspace_id=w.workspace_id
     WHERE w.workspace_id=? AND w.feature_id=? AND w.project_id=? AND w.envelope_id=? AND w.state=?
     AND w.state_revision=? AND f.current_revision_id=v.revision_id AND f.state='APPROVED' AND f.state_revision=?
     AND d.state='APPROVED' AND d.latest_document_revision_id=a.revision_id AND d.config_revision=v.config_revision
     AND p.config_revision=v.config_revision AND n.state IN ('READY','MANUAL_VERIFIED') AND n.state_revision=?
     AND n.workspace_generation=w.owner_generation AND pr.digest=?
     AND NOT EXISTS (SELECT 1 FROM json_each(pr.dependencies) dep
       LEFT JOIN profiles_records item ON item.entity_id=json_extract(dep.value,'$.entityId')
       WHERE item.entity_id IS NULL OR item.state='DISABLED'
       OR item.revision_id IS NOT json_extract(dep.value,'$.revisionId')
       OR CAST(item.state_revision AS TEXT) IS NOT json_extract(dep.value,'$.stateRevision'))
     AND EXISTS(SELECT 1 FROM json_each(pr.snapshot,'$.effectivePermissions') WHERE value='WORKSPACE_WRITE')
     AND p.removed_at IS NULL AND p.config_revision=pr.project_revision AND pr.project_id=p.project_id AND pr.capability_digest=?`)
     .get(e.profileResolutionId,e.workspaceId,e.featureId,e.projectId,e.envelopeId,leased?'IN_USE':'READY',
       BigInt(String(p.workspaceRevision))+(leased?1n:0n),BigInt(String(p.featureRevision)),
       BigInt(String(p.environmentRevision)),p.profileDigest,r.capabilityDigest);
   if(!target)throw new Error('EXECUTION_APPROVAL_STALE');
 }
 if('admission' in c){
   const {admission:a}=c,i=ledger.intent(a.canonicalIntent);
   const action=c.kind==='begin'?(c.session.sessionId===a.requestId?'start':'resume'):
     c.kind==='configure'||c.kind==='check'?`provider.${c.kind}`:c.kind==='control'?c.requested.toLowerCase():c.kind;
   if(i.namespace!=='EXECUTION'||i.action!==action)throw new Error('INVALID_REQUEST');
   const prior=ledger.operation(a.requestId);
   if(prior){
     ledger.admit(a);
     return result(a.requestId,initial?read({kind:'run',id:initial}).run:null,undefined,false);
   }
   const p=i.payload;
   const admission=ledger.admit(a,()=>{
     if(c.kind==='configure'||c.kind==='check'){
       const next=c.provider,old=read({kind:'provider',id:next.providerId}).provider;
       if(p.providerId!==next.providerId||i.configRevision!==(old?.configRevision??null))throw new Error('EXECUTION_APPROVAL_STALE');
       if(c.kind==='configure'){
         if(next.configRevision!==String(BigInt(old?.configRevision??'0')+1n)||next.status!=='UNQUALIFIED'||next.capabilityDigest!==null||
            p.binaryHandle!==next.binaryRef||p.modelId!==next.modelId||p.authProfileRef!==next.authProfileRef)throw new Error('INVALID_REQUEST');
       }else if(!old||next.configRevision!==old.configRevision||next.binaryRef!==old.binaryRef||next.modelId!==old.modelId||next.authProfileRef!==old.authProfileRef)
         throw new Error('EXECUTION_APPROVAL_STALE');
       const {providerId,configRevision,...metadata}=next;
       db.prepare(`INSERT INTO execution_providers VALUES(?,?,?) ON CONFLICT(provider_id) DO UPDATE SET config_revision=excluded.config_revision,metadata=excluded.metadata`)
         .run(providerId,BigInt(configRevision),JSON.stringify(metadata));
       ledger.complete(a.requestId,{providerId,configRevision,status:next.status,capabilityDigest:next.capabilityDigest},next.error,next.error?'BLOCKED':'SUCCEEDED');
       return;
     }
     if(c.kind==='begin'){
       const r=c.run,e=c.session;
       if(a.requestId!==r.runId||a.instanceId!==r.instanceId||r.sessionId!==e.sessionId||e.runId!==r.runId||r.phase!=='PREPARED'||
          p.providerId!==r.providerId||p.inputDigest!==r.inputDigest||p.capabilityDigest!==r.capabilityDigest||p.workspaceId!==e.workspaceId||
          p.envelopeId!==e.envelopeId||p.profileResolutionId!==e.profileResolutionId||i.projectId!==e.projectId||
          (action==='start'?i.targetId!==e.featureId:i.targetId!==e.sessionId))throw new Error('INVALID_REQUEST');
       const config=read({kind:'provider',id:r.providerId}).provider;
       if(!config||config.configRevision!==i.configRevision||config.configRevision!==r.configRevision||config.status!=='QUALIFIED'||config.capabilityDigest!==r.capabilityDigest)
         throw new Error('EXECUTION_APPROVAL_STALE');
       checkTuple(e,r,i,false);
       requireUuid(r.generation);
       if(read({kind:'active'}).run||db.prepare("SELECT 1 FROM features_turns WHERE phase IN ('ACCEPTED','RUNNING','RECONCILING')").get()||
          db.prepare('SELECT 1 FROM discovery_slot WHERE discovery_id IS NOT NULL').get())throw new Error('BUSY');
       if(action==='start'){
         if(e.state!=='CREATED'||e.stateRevision!=='1'||e.checkpointId!==null)throw new Error('INVALID_REQUEST');
         db.prepare(`INSERT INTO execution_sessions VALUES(?,?,?,?,?,'CREATED',1,?,NULL,?,?,?)`)
           .run(e.sessionId,e.featureId,e.workspaceId,e.projectId,e.profileResolutionId,r.runId,e.envelopeId,now(),now());
       }else{
         const old=read({kind:'session',id:e.sessionId}).session;
         const saved=e.checkpointId?read({kind:'checkpoint',id:e.checkpointId}).checkpoint:null;
         if(!old||!saved||saved.sessionId!==old.sessionId||old.checkpointId!==saved.checkpointId||p.checkpointId!==saved.checkpointId||
            saved.inputDigest!==r.inputDigest||old.stateRevision!==i.expectedRevision||!['PAUSED','INTERRUPTED'].includes(old.state))
           throw new Error('CHECKPOINT_STALE');
         verifyArtifact(saved.patchArtifactId);
         db.prepare(`UPDATE execution_sessions SET run_id=?,state='CREATED',state_revision=state_revision+1,updated_at=? WHERE session_id=?`)
           .run(r.runId,now(),old.sessionId);
       }
       db.prepare(`INSERT INTO execution_runs(run_id,session_id,generation,instance_id,provider_id,config_revision,capability_digest,input_digest,phase,outcome)
        VALUES(?,?,?,?,?,?,?,?,'PREPARED','IN_PROGRESS')`).run(r.runId,e.sessionId,r.generation,r.instanceId,r.providerId,BigInt(r.configRevision),r.capabilityDigest,r.inputDigest);
       db.prepare("UPDATE workflow_operations SET phase='WORKING',result=? WHERE request_id=?").run(JSON.stringify({sessionId:e.sessionId,runId:r.runId,generation:r.generation}),a.requestId);
       return;
     }
     if(c.kind==='answer'){
       const q=read({kind:'interaction',id:c.interactionId}).interaction;
       const r=q?read({kind:'run',id:q.runId}).run:null,e=r?read({kind:'session',id:r.sessionId}).session:null;
       if(!q||!r||!e||q.status!=='OPEN'||q.type!=='QUESTION'||q.generation!==r.generation||r.phase!=='RUNNING'||r.requested||
          e.runId!==r.runId||e.state!=='WAITING_USER'||e.stateRevision!==q.expectedRevision||i.expectedRevision!==q.expectedRevision||
          i.targetId!==q.interactionId||p.answerArtifactId!==c.answerArtifactId||p.generation!==r.generation)throw new Error('EXECUTION_APPROVAL_STALE');
       artifact(c.answerArtifactId,'INPUT',e.featureId,EXECUTION_LIMITS.interactionBytes);
       db.prepare("UPDATE execution_interactions SET status='ANSWERED',answer_artifact_id=? WHERE interaction_id=?").run(c.answerArtifactId,q.interactionId);
       updateState(e,'RUNNING');
       ledger.complete(a.requestId,{sessionId:e.sessionId,runId:r.runId,answerId:c.answerArtifactId});
       return;
     }
     if(c.kind==='checkpoint'){
       const v=c.checkpoint,e=read({kind:'session',id:v.sessionId}).session,r=read({kind:'run',id:v.runId}).run;
       if(!e||!r||v.checkpointId!==a.requestId||i.targetId!==v.sessionId||e.runId!==r.runId||e.stateRevision!==i.expectedRevision||
          p.treeDigest!==v.treeDigest||p.patchArtifactId!==v.patchArtifactId||p.digest!==v.digest||r.inputDigest!==v.inputDigest||r.phase!=='FINALIZED'||
          !['PAUSED','INTERRUPTED','CANCELLED','READY_FOR_REVIEW'].includes(e.state)||
          !db.prepare("SELECT 1 FROM workspaces_records WHERE workspace_id=? AND state='READY' AND state_revision=?").get(e.workspaceId,BigInt(String(p.workspaceRevision)))||
          db.prepare('SELECT 1 FROM workspaces_leases WHERE workspace_id=? AND released_at IS NULL').get(e.workspaceId))throw new Error('CHECKPOINT_STALE');
       const blob=artifact(v.patchArtifactId,'CHECKPOINT',e.sessionId,EXECUTION_LIMITS.checkpointBytes);
       if(blob.sha256!==v.digest)throw new Error('ARTIFACT_CORRUPT');
       db.prepare('INSERT INTO execution_checkpoints VALUES(?,?,?,?,?,?,?,?)')
         .run(v.checkpointId,v.sessionId,v.runId,v.inputDigest,v.treeDigest,v.patchArtifactId,v.digest,now());
       db.prepare('UPDATE execution_sessions SET checkpoint_id=? WHERE session_id=?').run(v.checkpointId,e.sessionId);
       updateState(e,e.state);
       ledger.complete(a.requestId,{sessionId:e.sessionId,runId:r.runId,checkpointId:v.checkpointId,digest:v.digest});
       return;
     }
     if(c.kind==='control'){
       const r=read({kind:'run',id:c.runId}).run,e=r?read({kind:'session',id:r.sessionId}).session:null;
       if(!r||!e||r.instanceId!==a.instanceId||r.phase==='FINALIZED'||r.requested||e.runId!==r.runId||i.targetId!==e.sessionId||
         i.expectedRevision!==e.stateRevision||p.generation!==r.generation||!['CREATED','RUNNING','WAITING_USER'].includes(e.state))
         throw new Error('EXECUTION_APPROVAL_STALE');
       db.prepare('UPDATE execution_runs SET requested=?,control_request_id=? WHERE run_id=?').run(c.requested,a.requestId,r.runId);
       db.prepare("UPDATE workflow_operations SET phase='WORKING',result=? WHERE request_id=?").run(JSON.stringify({sessionId:e.sessionId,runId:r.runId,generation:r.generation}),a.requestId);
       updateState(e,c.requested==='PAUSE'?'PAUSING':'CANCELLING');
       return;
     }
     if(c.kind==='reconcile'){
       const e=read({kind:'session',id:c.sessionId}).session;
       if(!e||i.targetId!==e.sessionId)throw new Error('OPERATION_NOT_FOUND');
       const unresolved=e.state==='RECONCILING';
       ledger.complete(a.requestId,{sessionId:e.sessionId,runId:e.runId,state:e.state},unresolved?'PROCESS_UNKNOWN':null,unresolved?'BLOCKED':'SUCCEEDED');
     }
   });
   return result(a.requestId,initial?read({kind:'run',id:initial}).run:null,undefined,admission.inserted);
 }
 const r=read({kind:'run',id:c.runId}).run,e=r?read({kind:'session',id:r.sessionId}).session:null;
 if(!r||!e||e.runId!==r.runId||r.phase==='FINALIZED')throw new Error('STALE_TARGET');
 return ledger.transaction(()=>{
   const owner=db.prepare('SELECT current_instance_id FROM store WHERE singleton=1').get() as FeatureRow;
   if(c.instanceId!==owner.current_instance_id||r.instanceId!==c.instanceId&&!(c.kind==='end'&&c.recovering)||
      ('generation' in c&&r.generation!==c.generation))throw new Error('STALE_TARGET');
   if(c.kind==='stage'){
     const id=c.identity;
     if(r.runId!==requireUuid(id.runId)||r.generation!==requireUuid(id.generation)||r.requested||e.state==='RECONCILING')throw new Error('STALE_TARGET');
     requireUuid(id.challenge);
     if(r.identity)requireExecutionIdentity(r.identity,id);
     const lease=db.prepare(`SELECT lease_id FROM workspaces_leases WHERE lease_id=? AND workspace_id=? AND holder_type='RUN'
       AND holder_id=? AND generation=? AND instance_id=? AND released_at IS NULL`).get(requireUuid(id.leaseId),e.workspaceId,r.runId,r.generation,r.instanceId);
     if(!lease)throw new Error('OWNERSHIP_UNPROVEN');
     const next=executionTransition(r.phase,c.event);
     if(c.event!=='ready')checkTuple(e,r,ledger.intent(ledger.operation(r.runId)!.canonicalIntent),true);
     db.prepare('UPDATE execution_runs SET phase=?,identity=?,lease_id=? WHERE run_id=?').run(next,JSON.stringify(id),id.leaseId,r.runId);
     if(c.event==='go')updateState(e,'RUNNING');
   }else if(c.kind==='end'){
     const beforeGo=r.phase==='PREPARED'||r.phase==='HOST_READY';
     if(c.noLaunch&&!beforeGo)throw new Error('PROCESS_UNKNOWN');
     if(!c.noLaunch&&c.proof&&(!r.identity||beforeGo))throw new Error('STALE_TARGET');
     const terminal=c.noLaunch?{state:r.requested==='CANCEL'?'CANCELLED':r.requested==='PAUSE'?'PAUSED':'INTERRUPTED',outcome:'INTERRUPTED'} as const:
       r.identity?executionCompletion(r.identity,c.proof,r.requested):{state:'RECONCILING',outcome:'UNKNOWN'} as const;
     const {state,outcome}=terminal;
     const error=outcome==='UNKNOWN'?'PROCESS_UNKNOWN':outcome==='SUCCEEDED'?null:c.error??(outcome==='FAILED'?'BLOCKED':'INTERRUPTED');
     if(e.state!==state)updateState(e,state);
     db.prepare('UPDATE execution_runs SET phase=?,outcome=?,proof=? WHERE run_id=?')
       .run(outcome==='UNKNOWN'?r.phase:'FINALIZED',outcome,c.proof?JSON.stringify(c.proof):null,r.runId);
     ledger.complete(r.runId,{sessionId:e.sessionId,runId:r.runId,generation:r.generation,state},error,outcome);
     if(r.controlRequestId)ledger.complete(r.controlRequestId,{sessionId:e.sessionId,runId:r.runId,state},
       outcome==='UNKNOWN'?error:null,outcome==='UNKNOWN'?'UNKNOWN':'SUCCEEDED');
   }else if(c.kind==='output'){
     if(r.phase!=='RUNNING'||e.state==='RECONCILING')throw new Error('STALE_TARGET');
     const count=db.prepare('SELECT COALESCE(SUM(bytes),0) AS bytes FROM execution_output WHERE run_id=?').get(r.runId) as FeatureRow;
     const available=Math.min(EXECUTION_LIMITS.outputChunkBytes,EXECUTION_LIMITS.outputBytes-Number(count.bytes));
     const size=c.artifactId?readFeatureState(db,{kind:'artifact',id:c.artifactId}).artifact?.expectedBytes??0:0;
     if(!c.artifactId||size>available){
       db.prepare('UPDATE execution_runs SET truncated=1 WHERE run_id=?').run(r.runId);
     }else if(!r.truncated){
       const value=artifact(c.artifactId,'OUTPUT',r.runId,available),seq=BigInt(r.outputWatermark)+1n;
       db.prepare('INSERT INTO execution_output VALUES(?,?,?,?,?)').run(r.runId,seq,value.artifactId,value.sha256,value.expectedBytes);
       db.prepare('UPDATE execution_runs SET output_watermark=? WHERE run_id=?').run(seq,r.runId);
     }
   }else if(c.kind==='question'){
     const q=c.interaction;
     if(q.runId!==r.runId||q.generation!==r.generation||q.status!=='OPEN'||q.answerArtifactId!==null||
        q.expectedRevision!==String(BigInt(e.stateRevision)+1n)||r.phase!=='RUNNING'||r.requested||e.state!=='RUNNING')
       throw new Error('STALE_TARGET');
     const count=db.prepare('SELECT COUNT(*) AS count FROM execution_interactions WHERE run_id=?').get(r.runId) as FeatureRow;
     if(Number(count.count)>=EXECUTION_LIMITS.interactions)throw new Error('RESOURCE_LIMIT');
     artifact(q.textArtifactId,'OUTPUT',r.runId,EXECUTION_LIMITS.interactionBytes);
     db.prepare('INSERT INTO execution_interactions VALUES(?,?,?,?,?,?,?,NULL)')
       .run(requireUuid(q.interactionId),q.runId,q.generation,BigInt(q.expectedRevision),q.textArtifactId,q.type,q.status);
     updateState(e,'WAITING_USER');
   }
   return result(r.runId,read({kind:'run',id:r.runId}).run,read({kind:'session',id:e.sessionId}).session);
 },c.kind==='end'||c.kind==='output'&&c.artifactId===null,{executionOutput:c.kind==='output',requestIds:[r.runId,...(r.controlRequestId?[r.controlRequestId]:[])]});
}
