import type Database from 'better-sqlite3';
import {createHash} from 'node:crypto';
import {requireDecimal,requireUuid} from '../domain/identifiers.js';
import {requireSkillSelection} from '../domain/profiles/skills.js';
import {PROFILE_LIMITS,profileTransition} from '../domain/profiles/model.js';
import type {ProfileKind} from '../domain/profiles/model.js';
import type {ProfilePreview,ProfileQuery,ProfileRead,ProfileRecord,ProfileResolution,ProfileRevision,ProfileWrite} from '../ports/profile.js';
import type {WorkflowIntent} from '../domain/workflow/authorization.js';
import type {FeatureLedger} from './features-authoring.js';
import {readFeatureState} from './features-store.js';
import {PROFILE_SCHEMA_VERSION} from './profiles-schema.js';

type Row=Record<string,string|number|bigint|null>;
const optional=(value:Row[string]|undefined)=>value==null?null:String(value);
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
function schema(db:Database.Database){
 if(Number(db.pragma('user_version',{simple:true}))<PROFILE_SCHEMA_VERSION)throw new Error('PROFILE_NOT_INITIALIZED');
}
function record(r:Row):ProfileRecord{
 return{entityId:String(r.entity_id),kind:r.kind as ProfileKind,scope:r.scope as ProfileRecord['scope'],projectId:optional(r.project_id),
   ownerProfileId:optional(r.owner_profile_id),alias:String(r.alias),state:r.state as ProfileRecord['state'],stateRevision:String(r.state_revision),
   revisionId:optional(r.revision_id),updatedAt:String(r.updated_at)};
}
function revision(r:Row):ProfileRevision{
 return{revisionId:String(r.revision_id),entityId:String(r.entity_id),previousId:optional(r.previous_id),digest:String(r.digest),
   artifactId:optional(r.artifact_id),byteLength:Number(r.byte_length),document:JSON.parse(String(r.document)),createdAt:String(r.created_at)};
}
function resolution(r:Row):ProfileResolution{
 return{resolutionId:String(r.resolution_id),profileId:String(r.profile_id),revisionId:String(r.revision_id),projectId:String(r.project_id),
   projectRevision:String(r.project_revision),capabilityDigest:String(r.capability_digest),digest:String(r.digest),
   dependencyVersions:JSON.parse(String(r.dependencies)),snapshot:JSON.parse(String(r.snapshot)),createdAt:String(r.created_at)};
}
export function readProfileState(db:Database.Database,query:ProfileQuery):ProfileRead{
 schema(db);
 switch(query.kind){
   case 'record':{
     const row=db.prepare('SELECT * FROM profiles_records WHERE entity_id=?').get(requireUuid(query.id)) as Row|undefined;
     return{record:row?record(row):null};
   }
   case 'revision':{
     const row=db.prepare('SELECT * FROM profiles_revisions WHERE revision_id=?').get(requireUuid(query.id)) as Row|undefined;
     return{revision:row?revision(row):null};
   }
   case 'resolution':{
     const row=db.prepare('SELECT * FROM profiles_resolutions WHERE resolution_id=?').get(requireUuid(query.id)) as Row|undefined;
     return{resolution:row?resolution(row):null};
   }
   case 'preview':{
     const row=db.prepare('SELECT evidence FROM profiles_previews WHERE preview_id=?').get(requireUuid(query.id)) as Row|undefined;
     return{preview:row?JSON.parse(String(row.evidence)) as ProfilePreview:null};
   }
   case 'artifact':{
     const value=db.prepare(`SELECT sha256,expected_bytes FROM workflow_artifacts a WHERE artifact_id=? AND state='REFERENCED'
       AND (EXISTS(SELECT 1 FROM profiles_revisions WHERE artifact_id=a.artifact_id) OR EXISTS(SELECT 1 FROM profiles_previews WHERE artifact_id=a.artifact_id))`)
       .get(requireUuid(query.id)) as Row|undefined;
     return{artifact:value?{sha256:String(value.sha256),bytes:Number(value.expected_bytes)}:null};
   }
   case 'aliases':{
     const rows=db.prepare(`SELECT * FROM profiles_records WHERE kind='SKILL' AND alias=? AND
       (scope='GLOBAL' OR scope='PROJECT' AND project_id=? OR scope='PROFILE' AND owner_profile_id=? AND (project_id IS NULL OR project_id=?))`)
       .all(query.alias,requireUuid(query.projectId),requireUuid(query.ownerProfileId),query.projectId) as Row[];
     return{records:rows.map(record)};
   }
   case 'list':{
     const projectId=query.projectId===null?null:requireUuid(query.projectId),limit=query.limit??20,offset=query.offset??0;
     if(!Number.isInteger(limit)||limit<1||limit>20||!Number.isSafeInteger(offset)||offset<0||!['PROFILE','SKILL','TOOL'].includes(query.entityKind))
       throw new Error('INVALID_REQUEST');
     const rows=db.prepare("SELECT * FROM profiles_records WHERE kind=? AND (project_id IS NULL OR project_id=?) ORDER BY alias,entity_id LIMIT ? OFFSET ?")
       .all(query.entityKind,projectId,limit+1,offset) as Row[];
     const store=db.prepare('SELECT revision FROM store WHERE singleton=1').get() as Row;
     return{records:rows.slice(0,limit).map(record),nextOffset:rows.length>limit?offset+limit:null,storeRevision:String(store.revision)};
   }
 }
}
function verifyProject(db:Database.Database,id:string|null,expected:string|null){
 if(id===null){if(expected!==null)throw new Error('STALE_TARGET');return;}
 const row=db.prepare('SELECT config_revision,removed_at FROM projects WHERE project_id=?').get(requireUuid(id)) as Row|undefined;
 if(!row||row.removed_at!==null)throw new Error('PROJECT_REMOVED');
 if(String(row.config_revision)!==expected)throw new Error('PROFILE_STALE');
}
function verifyDependencies(db:Database.Database,dependencies:ProfileResolution['dependencyVersions']){
 if(dependencies.length>31||new Set(dependencies.map(value=>value.entityId)).size!==dependencies.length)throw new Error('PROFILE_CONFLICT');
 for(const ref of dependencies){
   const {record}=readProfileState(db,{kind:'record',id:ref.entityId});
   if(!record||record.state==='DISABLED'||record.stateRevision!==ref.stateRevision||record.revisionId!==ref.revisionId)throw new Error('PROFILE_STALE');
 }
}
function reference(db:Database.Database,id:string,digest:string,size:number,verify:(artifactId:string)=>void){
 const artifact=readFeatureState(db,{kind:'artifact',id}).artifact;
 if(!artifact||artifact.kind!=='BUNDLE'||!['SEALED','REFERENCED'].includes(artifact.state)||artifact.sha256!==digest||artifact.expectedBytes!==size)
   throw new Error('ARTIFACT_CORRUPT');
 verify(id);
 db.prepare("UPDATE workflow_artifacts SET ref_count=ref_count+1,state='REFERENCED' WHERE artifact_id=?").run(id);
}
function writeRecord(db:Database.Database,change:Extract<ProfileWrite,{kind:'record'}>,intent:WorkflowIntent,verify:(id:string)=>void){
 const value=change.record,id=requireUuid(value.entityId),rev=change.revision;
 if(intent.targetId!==id||value.projectId!==intent.projectId||!Number.isFinite(Date.parse(value.updatedAt)))throw new Error('STALE_TARGET');
 const {record:prior}=readProfileState(db,{kind:'record',id});
 if(prior){
   if(prior.stateRevision!==change.priorStateRevision||prior.stateRevision!==intent.expectedRevision||
     BigInt(prior.stateRevision)+1n!==BigInt(requireDecimal(value.stateRevision)))throw new Error('PROFILE_STALE');
   const transition=intent.action==='disable'?'disable':intent.action==='tool.enable'?'enable':'revise';
   if(value.state!==profileTransition(prior.kind,prior.state,transition)||
     transition==='revise'&&!['revise','skill.bind'].includes(intent.action))throw new Error('INVALID_TRANSITION');
 }else{
   const expected={PROFILE:'create',SKILL:'skill.import',TOOL:'tool.import'}[value.kind];
   const count=db.prepare('SELECT count(*) AS count FROM profiles_records WHERE kind=?').get(value.kind) as Row;
   const maximum={PROFILE:PROFILE_LIMITS.profiles,SKILL:PROFILE_LIMITS.skills,TOOL:PROFILE_LIMITS.tools}[value.kind];
   if(intent.action!==expected||change.priorStateRevision!==undefined||value.stateRevision!=='1'||value.state!==(value.kind==='PROFILE'?'ENABLED':'REVIEWED')||!rev)
     throw new Error('INVALID_TRANSITION');
   if(Number(count.count)>=maximum)throw new Error('RESOURCE_LIMIT');
   if(db.prepare('SELECT 1 FROM profiles_records WHERE kind=? AND scope=? AND project_id IS ? AND owner_profile_id IS ? AND alias=?')
     .get(value.kind,value.scope,value.projectId,value.ownerProfileId,value.alias))throw new Error('PROFILE_CONFLICT');
 }
 if(intent.action==='tool.enable'){
   const count=db.prepare("SELECT count(*) AS count FROM profiles_records WHERE kind='TOOL' AND state='ENABLED'").get() as Row;
   if(!rev)throw new Error('INVALID_TRANSITION');
   if(Number(count.count)>=PROFILE_LIMITS.enabledTools)throw new Error('RESOURCE_LIMIT');
 }
 if(change.dependencies)verifyDependencies(db,change.dependencies);
 if(change.previewId){
   const {preview}=readProfileState(db,{kind:'preview',id:change.previewId});
   if(!preview||preview.expiresAtMs<=change.admission.nowMs||preview.sourceDigest!==intent.payload.sourceDigest||
     preview.artifactId!==rev?.artifactId||preview.scope!==value.scope||preview.projectId!==value.projectId||preview.ownerProfileId!==value.ownerProfileId)
     throw new Error('PROFILE_STALE');
 }
 if(rev){
   if(rev.revisionId!==change.admission.requestId||rev.revisionId!==value.revisionId||rev.entityId!==id||rev.previousId!==(prior?.revisionId??null)||
     !/^[a-f0-9]{64}$/.test(rev.digest)||!Number.isFinite(Date.parse(rev.createdAt)))throw new Error('INVALID_REQUEST');
   if(['create','revise'].includes(intent.action)&&(rev.artifactId!==intent.payload.bundleArtifactId||
     intent.payload.artifactDigest!==undefined&&rev.digest!==intent.payload.artifactDigest)||
     intent.action==='tool.import'&&(rev.artifactId!==intent.payload.manifestArtifactId||rev.digest!==intent.payload.sourceDigest)||
     intent.action==='tool.enable'&&rev.digest!==intent.payload.sourceDigest)throw new Error('APPROVAL_STALE');
   if(rev.artifactId)reference(db,rev.artifactId,rev.digest,rev.byteLength,verify);
   db.prepare('INSERT INTO profiles_revisions VALUES(?,?,?,?,?,?,?,?)').run(rev.revisionId,id,rev.previousId,rev.digest,rev.artifactId,
     rev.byteLength,JSON.stringify(rev.document),rev.createdAt);
 }else if(!prior||prior.revisionId!==value.revisionId||intent.action!=='disable')throw new Error('INVALID_TRANSITION');
 if(prior){
   const changed=db.prepare('UPDATE profiles_records SET state=?,state_revision=?,revision_id=?,updated_at=? WHERE entity_id=? AND state_revision=?')
     .run(value.state,BigInt(value.stateRevision),value.revisionId,value.updatedAt,id,BigInt(prior.stateRevision));
   if(changed.changes!==1)throw new Error('PROFILE_STALE');
 }else db.prepare('INSERT INTO profiles_records VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,value.kind,value.scope,value.projectId,value.ownerProfileId,
   value.alias,value.state,BigInt(value.stateRevision),value.revisionId,value.updatedAt);
 return{entityId:id,revisionId:value.revisionId,stateRevision:value.stateRevision};
}
export function commitProfileState(db:Database.Database,change:ProfileWrite,ledger:FeatureLedger,verify:(id:string)=>void){
 schema(db);
 const {admission}=change,intent=ledger.intent(admission.canonicalIntent);
 if(intent.namespace!=='PROFILE')throw new Error('APPROVAL_REQUIRED');
 return ledger.admit(admission,()=>{
   const owner=db.prepare('SELECT i.lifecycle FROM instances i JOIN store s ON i.instance_id=s.current_instance_id WHERE i.instance_id=?').get(admission.instanceId) as Row|undefined;
   if(owner?.lifecycle!=='RUNNING')throw new Error('BLOCKED');
   verifyProject(db,intent.projectId,intent.configRevision);
   if(change.kind==='record'){ledger.complete(admission.requestId,writeRecord(db,change,intent,verify));return;}
   if(change.kind==='preview'){
     const {preview}=change;
     if(intent.action!=='skill.preview'||preview.previewId!==admission.requestId||intent.targetId!==preview.previewId||
       preview.projectId!==intent.projectId||preview.scope!==intent.payload.scope||preview.ownerProfileId!==intent.payload.ownerProfileId||
       preview.sourceDigest!==intent.payload.sourceDigest||preview.expiresAtMs<=admission.nowMs||preview.expiresAtMs>admission.nowMs+300000)
       throw new Error('INVALID_REQUEST');
     reference(db,preview.artifactId,preview.artifactDigest,preview.byteLength,verify);
     db.prepare('INSERT INTO profiles_previews VALUES(?,?,?)').run(preview.previewId,preview.artifactId,JSON.stringify(preview));
     ledger.complete(admission.requestId,{previewId:preview.previewId,artifactId:preview.artifactId});return;
   }
   const {resolution}=change;
   if(intent.action!=='resolve'||resolution.resolutionId!==admission.requestId||resolution.profileId!==intent.targetId||
     resolution.projectId!==intent.projectId||resolution.projectRevision!==intent.configRevision||resolution.revisionId!==intent.payload.revisionId||
     resolution.capabilityDigest!==intent.payload.providerCapabilityDigest||resolution.digest!==hash(JSON.stringify(resolution.snapshot)))
     throw new Error('INVALID_REQUEST');
   verifyDependencies(db,resolution.dependencyVersions);
   for(const ref of resolution.dependencyVersions.slice(1)){
     const {record:dependency}=readProfileState(db,{kind:'record',id:ref.entityId});
     if(dependency?.kind==='SKILL'){
       const {records=[]}=readProfileState(db,{kind:'aliases',alias:dependency.alias,projectId:resolution.projectId,ownerProfileId:resolution.profileId});
       requireSkillSelection(dependency,records,resolution.projectId,resolution.profileId);
     }
   }
   const profile=readProfileState(db,{kind:'record',id:resolution.profileId}).record;
   if(!profile||profile.kind!=='PROFILE'||profile.state==='DISABLED'||profile.revisionId!==resolution.revisionId||profile.stateRevision!==intent.expectedRevision)
     throw new Error('PROFILE_STALE');
   db.prepare('INSERT INTO profiles_resolutions VALUES(?,?,?,?,?,?,?,?,?,?)').run(resolution.resolutionId,resolution.profileId,resolution.revisionId,
     resolution.projectId,BigInt(resolution.projectRevision),resolution.capabilityDigest,resolution.digest,JSON.stringify(resolution.snapshot),
     JSON.stringify(resolution.dependencyVersions),resolution.createdAt);
   ledger.complete(admission.requestId,{resolutionId:resolution.resolutionId,entityId:resolution.profileId,revisionId:resolution.revisionId});
 });
}
