import {randomUUID,createHash} from 'node:crypto';
import type {StoragePort} from '../../ports/storage.js';
import type {ArchivePaths,AuthenticatedPeer} from '../../ports/platform.js';
import type {DiscoveryEligibility} from '../../domain/discovery/approval.js';
import type {DiscoveryMetadataData,DiscoveryMetadataQuery} from '../../ports/discovery.js';
import type {DiscoveryRecord} from '../../domain/discovery/model.js';
import type {FeatureBundle,FeatureContextProof,FeatureProvenanceScope} from '../../ports/feature.js';
import type {FeatureRecord,FeatureRevision} from '../../domain/features/model.js';
import {nextFeatureRevision,requireFeatureContext,transitionFeature} from '../../domain/features/model.js';
import {validateFeatureBundle} from '../../domain/features/bundle.js';
import {publicFeatureOperation,validateFeatureParams} from '../../protocol/feature.js';
import {createWorkflowAuthorization} from '../workflow/authorization.js';
import {originalWorkflowGrant,workflowAdmission} from '../workflow/admission.js';
import type {WorkflowIntent} from '../../domain/workflow/authorization.js';
import {classifyError} from '../control-main.js';
export interface FeatureAuthoringOptions {
 readonly storage:StoragePort;readonly paths:ArchivePaths;readonly instanceId:string;
 readonly currentEligibility?:(peer:AuthenticatedPeer,projectId:string)=>Promise<DiscoveryEligibility>;
 readonly schedule:(work:()=>Promise<void>)=>void;readonly accepting:()=>boolean;
}
export function createFeatureAuthoring(options:FeatureAuthoringOptions){
 const {storage,paths,instanceId}=options,authorization=createWorkflowAuthorization({storage,paths,instanceId}),active=new Map<string,string>();
 const methods=['feature.prepare','feature.create','feature.revise','feature.archive'];
 async function metadata<Q extends DiscoveryMetadataQuery>(q:Q):Promise<DiscoveryMetadataData<Q>>{if(!storage.readDiscoveryMetadata)throw new Error('DISCOVERY_REQUIRED');const r=await storage.readDiscoveryMetadata(q);if(!r.ok)throw new Error(r.code);return r.value.data;}
 async function currentContext(projectId:string,expectedConfig?:string){
 const project=await storage.getProject(projectId);if(!project)throw new Error('PROJECT_NOT_FOUND');if(project.project.removedAt!==null)throw new Error('PROJECT_REMOVED');if(expectedConfig!==undefined&&project.project.configRevision!==expectedConfig)throw new Error('REVISION_CONFLICT');
 let offset=0;const records:DiscoveryRecord[]=[];for(;;){const page=await metadata({kind:'discoveries',id:projectId,offset,limit:20});records.push(...page.items);if(records.length>100)throw new Error('DISCOVERY_LIMIT');if(page.nextOffset===null)break;offset=page.nextOffset;}
 const d=records.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.discoveryId.localeCompare(a.discoveryId))[0];if(!d||d.state!=='APPROVED'||!d.latestDocumentRevisionId||d.configRevision!==project.project.configRevision)throw new Error('DISCOVERY_REQUIRED');
 const approval=await metadata({kind:'approval',id:d.latestDocumentRevisionId}),revision=await metadata({kind:'revision',id:d.latestDocumentRevisionId});
 if(!approval||!revision||approval.projectId!==projectId||approval.storeId!==d.storeId||approval.revisionId!==revision.revisionId||approval.configRevision!==project.project.configRevision||approval.contextDigest!==revision.contextDigest||approval.bundleDigest!==revision.bundleDigest)throw new Error('APPROVAL_STALE');
 return{project:project.project,discovery:d,approval,revision};
 }
 async function provenance(d:DiscoveryRecord):Promise<FeatureProvenanceScope>{
 const snapshot=await metadata({kind:'snapshot',id:d.snapshotId});if(!snapshot?.manifestArtifactId||!storage.readDiscoveryManifestPage)throw new Error('ARTIFACT_CORRUPT');
 const sourceIds:string[]=[];let offset=0;for(;;){const page=await storage.readDiscoveryManifestPage(snapshot.manifestArtifactId,offset,20);if(!page.ok)throw new Error(page.code);sourceIds.push(...page.value.items.map(s=>s.sourceId));if(sourceIds.length>200)throw new Error('CONTEXT_LIMIT');if(page.value.nextOffset===null)break;offset=page.value.nextOffset;}
 const answerIds:string[]=[];offset=0;for(;;){const page=await metadata({kind:'answers',id:d.discoveryId,offset,limit:20});answerIds.push(...page.items.map(a=>a.answerId));if(answerIds.length>20)throw new Error('CONTEXT_LIMIT');if(page.nextOffset===null)break;offset=page.nextOffset;}
 return{sourceIds,answerIds};
 }
 async function bundle(artifactId:string,scope:FeatureProvenanceScope,featureId?:string){
 const a=(await storage.readFeatureState!({kind:'artifact',id:artifactId})).artifact;if(!a||!['SEALED','REFERENCED'].includes(a.state)||a.kind!=='BUNDLE'||a.targetId!==null&&a.targetId!==featureId||a.expectedBytes>262144||!storage.readWorkflowArtifact)throw new Error('ARTIFACT_CORRUPT');
 const chunks:Buffer[]=[];let offset=0;while(offset<a.expectedBytes){const r=await storage.readWorkflowArtifact(artifactId,offset,8192);if(!r.bytes.length||r.sha256!==a.sha256||r.totalBytes!==a.expectedBytes)throw new Error('ARTIFACT_CORRUPT');chunks.push(Buffer.from(r.bytes));offset+=r.bytes.length;}
 const bytes=Buffer.concat(chunks);if(createHash('sha256').update(bytes).digest('hex')!==a.sha256)throw new Error('ARTIFACT_CORRUPT');
 let data:unknown;try{data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new Error('INVALID_REQUEST');}
 return{artifact:a,bundle:validateFeatureBundle(data,scope)};
 }
 async function feature(id:string,expected?:string){const f=(await storage.readFeatureState!({kind:'feature',id})).feature;if(!f)throw new Error('FEATURE_NOT_FOUND');if(f.state==='ARCHIVED')throw new Error('FEATURE_IN_USE');if(expected!==undefined&&f.stateRevision!==expected)throw new Error('REVISION_CONFLICT');if(['PLANNING','WAITING_USER','RECONCILING'].includes(f.state))throw new Error('FEATURE_IN_USE');return f;}
 async function prepare(peer:AuthenticatedPeer,p:Readonly<Record<string,unknown>>){
 const snapshot=await authorization.guard(peer),action=p.action as string;if(!['create','revise','archive'].includes(action))throw new Error('UNSUPPORTED_VERSION');
 const old=action==='create'?null:await feature(p.featureId as string,p.expectedStateRevision as string);const projectId=old?.projectId??p.projectId as string;
 if(action==='archive')return authorization.prepare(peer,{version:1,storeId:snapshot.store.storeId,ownerUid:paths.ownerUid,namespace:'FEATURE',action,targetId:old!.featureId,projectId,expectedRevision:old!.stateRevision,configRevision:null,payload:{}});
 const context=await currentContext(projectId,p.expectedConfigRevision as string|undefined),featureId=old?.featureId??randomUUID(),b=await bundle(p.bundleArtifactId as string,await provenance(context.discovery),featureId);
 const previous=old?(await storage.readFeatureState!({kind:'revision',id:old.currentRevisionId})).revision:null;if(old&&!previous)throw new Error('ARTIFACT_CORRUPT');
 return authorization.prepare(peer,{version:1,storeId:snapshot.store.storeId,ownerUid:paths.ownerUid,namespace:'FEATURE',action,targetId:featureId,projectId,expectedRevision:old?.stateRevision??null,configRevision:context.project.configRevision,payload:{bundleArtifactId:b.artifact.artifactId,bundleDigest:b.artifact.sha256,title:b.bundle.title,revisionId:randomUUID(),revisionNumber:previous?nextFeatureRevision(previous.revisionNumber):'1',parentRevisionId:previous?.revisionId??null,discoveryApprovalId:context.approval.approvalId,discoveryRevisionId:context.revision.revisionId,contextDigest:context.revision.contextDigest}});
 }
 async function fresh(peer:AuthenticatedPeer,intent:WorkflowIntent):Promise<FeatureContextProof>{
 if(!options.currentEligibility||!intent.projectId||!intent.configRevision)throw new Error('DISCOVERY_REQUIRED');
 const e=await options.currentEligibility(peer,intent.projectId);if(!e.eligible)throw new Error(e.reason==='APPROVAL_STALE'?'APPROVAL_STALE':e.reason==='UNKNOWN'||e.reason==='CHECKING'?'CONTEXT_UNSTABLE':'DISCOVERY_REQUIRED');
 const proof:FeatureContextProof={projectId:intent.projectId,configRevision:intent.configRevision,discoveryApprovalId:e.approvalId!,discoveryRevisionId:e.revisionId!,contextDigest:e.contextDigest!,checkedAt:e.checkedAt!};requireFeatureContext(proof,intent.projectId,intent.configRevision);
 if(proof.discoveryApprovalId!==intent.payload.discoveryApprovalId||proof.discoveryRevisionId!==intent.payload.discoveryRevisionId||proof.contextDigest!==intent.payload.contextDigest)throw new Error('APPROVAL_STALE');return proof;
 }
 async function work(peer:AuthenticatedPeer,intent:WorkflowIntent,admission:ReturnType<typeof workflowAdmission>){
 try{
 if(intent.action==='archive'){await storage.commitFeatureState!({kind:'archive',admission,featureId:intent.targetId!,expectedRevision:intent.expectedRevision!});return;}
 const old=intent.action==='create'?null:await feature(intent.targetId!,intent.expectedRevision!),context=await currentContext(intent.projectId!,intent.configRevision!),b=await bundle(intent.payload.bundleArtifactId as string,await provenance(context.discovery),intent.targetId!);
 if(b.artifact.sha256!==intent.payload.bundleDigest||b.bundle.title!==intent.payload.title)throw new Error('APPROVAL_STALE');
 const proof=await fresh(peer,intent),at=new Date().toISOString();
 const record:FeatureRecord={featureId:intent.targetId!,projectId:intent.projectId!,title:b.bundle.title,state:old?transitionFeature(old.state,'revise'):'DRAFT',stateRevision:old?nextFeatureRevision(old.stateRevision):'1',currentRevisionId:intent.payload.revisionId as string,createdAt:old?.createdAt??at,updatedAt:at,archivedAt:null};
 const revision:FeatureRevision={revisionId:record.currentRevisionId,featureId:record.featureId,revisionNumber:intent.payload.revisionNumber as string,parentRevisionId:intent.payload.parentRevisionId as string|null,artifactId:b.artifact.artifactId,bundleDigest:b.artifact.sha256,discoveryApprovalId:proof.discoveryApprovalId,discoveryRevisionId:proof.discoveryRevisionId,contextDigest:proof.contextDigest,configRevision:proof.configRevision,createdAt:at};
 await storage.commitFeatureState!({kind:intent.action as 'create'|'revise',admission,feature:record,revision,contextCheckedAt:proof.checkedAt});
 }catch(error){const code=classifyError(error);try{await storage.commitFeatureState!({kind:'complete',requestId:admission.requestId,outcome:['PERSISTENCE_UNAVAILABLE','DEADLINE_EXCEEDED'].includes(code)?'UNKNOWN':'FAILED',result:null,error:code,nowMs:Date.now()});}catch{/* Preserve the original intent if storage cannot confirm finalization. */}}
 }
 return{methods,feature,currentContext,provenance,bundle,fresh,authorization,
 async run(method:string,p:Readonly<Record<string,unknown>>,peer:AuthenticatedPeer):Promise<Record<string,unknown>>{
 validateFeatureParams(method,p);if(!options.accepting())throw new Error('BLOCKED');await authorization.guard(peer);
 if(method==='feature.prepare')return prepare(peer,p);
 const action=method.split('.').at(-1)!;if(!['create','revise','archive'].includes(action))throw new Error('UNSUPPORTED_VERSION');
 const original=await originalWorkflowGrant(storage,p.requestId as string,p.grantId as string,action),intent=original.intent;
 if(p.featureId!==undefined&&p.featureId!==intent.targetId||p.projectId!==undefined&&p.projectId!==intent.projectId)throw new Error('APPROVAL_REQUIRED');
 if(original.operation)return{operation:publicFeatureOperation(original.operation)};
 const key=intent.projectId??intent.targetId!;if(active.has(key)||active.size>=4)throw new Error('BUSY');active.set(key,p.requestId as string);
 const admission=workflowAdmission({requestId:p.requestId as string,grantId:p.grantId as string,intent,instanceId,nowMs:Date.now()});
 try{const a=await storage.commitFeatureState!({kind:'admit',admission});if(!a.inserted){active.delete(key);return{operation:publicFeatureOperation(a.operation!)};}
 options.schedule(async()=>{try{await work(peer,intent,admission);}finally{active.delete(key);}});return{accepted:true,requestId:p.requestId,featureId:intent.targetId};
 }catch(e){active.delete(key);throw e;}
 },
 };
}
