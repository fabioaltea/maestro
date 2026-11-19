import type Database from 'better-sqlite3';
import {requireUuid} from '../domain/identifiers.js';
import type {WorkspaceChange,WorkspaceMutationTarget,WorkspaceQuery,WorkspaceRead,WorkspaceRecord,WorkspaceSummary,WorkspaceWrite} from '../ports/workspace.js';
import type {FilesystemAnchor,ReferenceCheckout,RepositoryIdentity} from '../ports/repository.js';
import {requireWorkspaceCapacity} from '../domain/workspaces/model.js';
import {requireCurrentFeatureApproval} from '../domain/features/approval.js';
import {currentDiscovery,type FeatureLedger} from './features-authoring.js';
import {readFeatureState} from './features-store.js';
import {WORKSPACE_SCHEMA_VERSION} from './workspaces-schema.js';

type Row=Record<string,string|number|bigint|null>;
export function requireWorkspaceSchema(database:Database.Database):void{
 if(Number(database.pragma('user_version',{simple:true}))!==WORKSPACE_SCHEMA_VERSION)throw new Error('WORKSPACE_NOT_INITIALIZED');
}
export function workspaceRecord(r:Row):WorkspaceRecord{
 return{
   workspaceId:String(r.workspace_id),featureId:String(r.feature_id),projectId:String(r.project_id),envelopeId:String(r.envelope_id),
   repositoryKey:String(r.repository_key),state:r.state as WorkspaceRecord['state'],stateRevision:String(r.state_revision),
   ownerGeneration:String(r.owner_generation),target:JSON.parse(String(r.target)) as WorkspaceRecord['target'],
   ownership:r.ownership===null?null:JSON.parse(String(r.ownership)) as WorkspaceRecord['ownership'],
   markerDigest:r.marker_digest===null?null:String(r.marker_digest),safeError:r.safe_error===null?null:String(r.safe_error),
   createdAt:String(r.created_at),updatedAt:String(r.updated_at),
 };
}
function summary(row:Row):WorkspaceSummary{
 const r=workspaceRecord(row);
 return{workspaceId:r.workspaceId,featureId:r.featureId,projectId:r.projectId,envelopeId:r.envelopeId,state:r.state,stateRevision:r.stateRevision,
   baseRef:r.target.baseRef,baseOid:r.target.baseOid,branchRef:`refs/heads/maestro/feature/${r.featureId}/${r.workspaceId}`,
   ownership:r.ownership?'RECORDED':'UNKNOWN',createdAt:r.createdAt,updatedAt:r.updatedAt,safeError:r.safeError};
}
export function readWorkspaceState(database:Database.Database,query:WorkspaceQuery):WorkspaceRead{
 requireWorkspaceSchema(database);
 if(query.kind==='get'||query.kind==='summary'){
   const row=database.prepare('SELECT * FROM workspaces_records WHERE workspace_id=?').get(requireUuid(query.id)) as Row|undefined;
   return query.kind==='get'?{workspace:row?workspaceRecord(row):null}:{summary:row?summary(row):null};
 }
 if(query.kind!=='list')throw new Error('INVALID_REQUEST');
 const projectId=requireUuid(query.projectId),offset=query.offset??0,limit=query.limit??20;
 if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>20)throw new Error('INVALID_REQUEST');
 const rows=database.prepare('SELECT * FROM workspaces_records WHERE project_id=? ORDER BY created_at,workspace_id LIMIT ? OFFSET ?').all(projectId,limit+1,offset) as Row[];
 const revision=database.prepare('SELECT revision FROM store WHERE singleton=1').get() as Row;
 return{items:rows.slice(0,limit).map(summary),nextOffset:rows.length>limit?offset+limit:null,pageRevision:String(revision.revision)};
}

function sameAnchor(left:FilesystemAnchor,right:FilesystemAnchor){
 return left.version===right.version&&left.kind===right.kind&&left.canonicalPath===right.canonicalPath
   &&left.device===right.device&&left.inode===right.inode&&left.birthtimeNs===right.birthtimeNs;
}

export function commitWorkspaceState(database:Database.Database,change:WorkspaceChange,ledger:FeatureLedger,verifyArtifact:(id:string)=>void):WorkspaceWrite{
 requireWorkspaceSchema(database);
 const {admission}=change,intent=ledger.intent(admission.canonicalIntent);
 if(change.kind!=='reserve'||intent.namespace!=='WORKSPACE'||intent.action!=='create'||!intent.targetId||!intent.projectId)throw new Error('APPROVAL_REQUIRED');
 const workspaceId=requireUuid(intent.targetId),projectId=requireUuid(intent.projectId),p=intent.payload;
 const admitted=ledger.admit(admission,()=>{
   const owner=database.prepare('SELECT lifecycle FROM instances WHERE instance_id=?').get(admission.instanceId) as Row|undefined;
   if(owner?.lifecycle!=='RUNNING')throw new Error('STALE_TARGET');
   const featureId=requireUuid(p.featureId),envelopeId=requireUuid(p.envelopeId),ownerGeneration=requireUuid(p.ownerGeneration),target=p.target as WorkspaceMutationTarget;
   const feature=readFeatureState(database,{kind:'feature',id:featureId}).feature;
   const envelope=readFeatureState(database,{kind:'envelope',id:envelopeId}).envelope;
   if(!feature||!envelope||workspaceId!==target?.workspaceId||featureId!==target.featureId||
     feature.projectId!==projectId||envelope.projectId!==projectId||envelope.featureId!==featureId
     ||envelope.digest!==p.envelopeDigest||feature.stateRevision!==intent.expectedRevision||envelope.configRevision!==intent.configRevision)
     throw new Error('APPROVAL_STALE');
   const revision=readFeatureState(database,{kind:'revision',id:feature.currentRevisionId}).revision;
   const approval=readFeatureState(database,{kind:'approval',id:feature.currentRevisionId}).approval??null;
   if(!revision||envelope.revisionId!==revision.revisionId||envelope.bundleDigest!==revision.bundleDigest||envelope.approvalId!==approval?.approvalId)
     throw new Error('APPROVAL_STALE');
   requireCurrentFeatureApproval(feature,revision,approval,{projectId,configRevision:revision.configRevision,
     contextDigest:revision.contextDigest,discoveryApprovalId:revision.discoveryApprovalId,discoveryRevisionId:revision.discoveryRevisionId,
     checkedAt:change.contextCheckedAt},intent.ownerUid);
   currentDiscovery(database,revision,projectId,change.contextCheckedAt);
   const artifact=readFeatureState(database,{kind:'artifact',id:revision.artifactId}).artifact;
   if(artifact?.state!=='REFERENCED'||artifact.kind!=='BUNDLE'||artifact.sha256!==revision.bundleDigest)throw new Error('ARTIFACT_CORRUPT');
   verifyArtifact(revision.artifactId);
   const project=database.prepare('SELECT repository_key,repository_identity,reference_checkout,base_branch FROM projects WHERE project_id=?').get(projectId) as Row;
   const identity=JSON.parse(String(project.repository_identity)) as RepositoryIdentity;
   const reference=JSON.parse(String(project.reference_checkout)) as ReferenceCheckout;
   if(project.repository_key!==p.repositoryKey||typeof project.base_branch!=='string'||target.baseRef!==`refs/heads/${project.base_branch}`
     ||!sameAnchor(identity.commonDirectory,target.commonDirectory)||!sameAnchor(reference.root,target.reference)
     ||!sameAnchor(reference.adminDirectory,target.adminDirectory))throw new Error('REPOSITORY_CHANGED');
   const count=database.prepare("SELECT count(*) AS count FROM workspaces_records WHERE state<>'REMOVED'").get() as Row;
   requireWorkspaceCapacity(Number(count.count));
   if(database.prepare("SELECT 1 FROM workspaces_effects WHERE repository_key=? AND phase<>'RESOLVED'").get(project.repository_key))throw new Error('WORKSPACE_IN_USE');
   const at=new Date(admission.nowMs).toISOString();
   database.prepare(`INSERT INTO workspaces_records
     (workspace_id,feature_id,project_id,envelope_id,repository_key,state,state_revision,owner_generation,target,created_at,updated_at)
     VALUES(?,?,?,?,?,'CREATING',1,?,?,?,?)`).run(workspaceId,featureId,projectId,envelopeId,project.repository_key,ownerGeneration,JSON.stringify(target),at,at);
   database.prepare("INSERT INTO workspaces_effects(request_id,workspace_id,repository_key,owner_generation,phase) VALUES(?,?,?,?,'INTENT')")
     .run(admission.requestId,workspaceId,project.repository_key,ownerGeneration);
 });
 const workspace=readWorkspaceState(database,{kind:'get',id:workspaceId}).workspace;
 return {...admitted,...(workspace?{workspace}:{})};
}
