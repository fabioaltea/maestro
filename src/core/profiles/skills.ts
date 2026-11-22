import {randomUUID} from 'node:crypto';
import {PROFILE_LIMITS} from '../../domain/profiles/model.js';
import {parseProfileDocument} from '../../domain/profiles/resolve.js';
import {parseProfilePermissions} from '../../domain/profiles/permissions.js';
import type {ProfilePreview,ProfileRecord} from '../../ports/profile.js';
import type {AuthenticatedPeer} from '../../ports/platform.js';
import {publicProfileOperation} from '../../protocol/profile.js';
import {publishPlanningArtifact} from '../features/artifacts.js';
import {originalWorkflowGrant} from '../workflow/admission.js';
import {documentRevision,next,version,type ProfileRegistry} from './registry.js';
import {profilePreviewSummary} from './read.js';

type Params=Readonly<Record<string,unknown>>;
export function createProfileSkills(registry:ProfileRegistry){
 const {context:{storage,paths,instanceId,source},authorization,project,record,revision,readBundle,makeIntent,grant,admit,save,query}=registry;
 const handles=new Map<string,{path:string;scope:string;expiresAt:number}>();
 const principal=(peer:AuthenticatedPeer)=>peer.credentialId;
 async function select(params:Params,peer:AuthenticatedPeer){
   await authorization.guard(peer);
   const at=Date.now(),path=String(params.source),scope=principal(peer);
   for(const [key,value] of handles){
     if(value.expiresAt<=at){handles.delete(key);continue;}
     if(value.path===path&&value.scope===scope)return{importHandle:key};
   }
   if(handles.size>=20)throw new Error('RESOURCE_LIMIT');
   const importHandle=randomUUID();
   handles.set(importHandle,{path,scope,expiresAt:at+300000});
   return{importHandle};
 }
 async function preview(params:Params,peer:AuthenticatedPeer){
   const {store}=await authorization.guard(peer),requestId=String(params.requestId),scope=params.scope as ProfilePreview['scope'];
   const handle=handles.get(String(params.importHandle));
   const ownerProfileId=typeof params.ownerProfileId==='string'?params.ownerProfileId:null,owner=ownerProfileId?await record(ownerProfileId):null;
   if(owner&&(owner.kind!=='PROFILE'||owner.state==='DISABLED'))throw new Error('PROFILE_STALE');
   const projectId=typeof params.projectId==='string'?params.projectId:owner?.projectId??null;
   if(owner?.projectId&&projectId!==owner.projectId)throw new Error('INVALID_REQUEST');
   const previous=await registry.existing(requestId,'skill.preview',intent=>intent.projectId===projectId&&
     intent.payload.scope===scope&&intent.payload.ownerProfileId===ownerProfileId);
   if(previous){
     const {preview}=await query({kind:'preview',id:requestId});
     if(!preview||(!handle||handle.path!==preview.sourcePath||handle.scope!==principal(peer))&&
       !(await sameHandle(requestId,params.importHandle)))throw new Error('IDEMPOTENCY_CONFLICT');
     return{...previous,preview:profilePreviewSummary(preview)};
   }
   if(!handle||handle.scope!==principal(peer)||handle.expiresAt<=Date.now())throw new Error('APPROVAL_STALE');
   const p=await project(projectId),observed=await source.read(handle.path);
   const requiredPermissions=parseProfilePermissions(observed.requiredPermissions);
   const artifact=await publishPlanningArtifact({storage,storeId:store.storeId,ownerUid:paths.ownerUid,instanceId,targetId:requestId},'BUNDLE',
     {alias:observed.alias,sourceDigest:observed.sourceDigest,requiredPermissions,files:observed.files});
   const value:ProfilePreview={previewId:requestId,scope,projectId,ownerProfileId,alias:observed.alias,sourceDigest:observed.sourceDigest,
     identity:observed.identity,sourcePath:handle.path,artifactId:artifact.artifactId,artifactDigest:artifact.sha256,byteLength:artifact.expectedBytes,
     files:observed.files.map(({text:_text,...file})=>file),requiredPermissions,expiresAtMs:Date.now()+299000};
   const intent=makeIntent(store,'skill.preview',requestId,projectId,null,p?.configRevision??null,
     {scope,ownerProfileId,sourceDigest:value.sourceDigest,importHandle:params.importHandle});
   const result=await save({kind:'preview',admission:admit(requestId,intent,null),preview:value});
   const saved=await query({kind:'preview',id:requestId});
   return{...result,preview:profilePreviewSummary(saved.preview??value)};
 }
 async function sameHandle(requestId:string,handle:unknown){
   const {operation}=await storage.readFeatureState!({kind:'operation',id:requestId});
   return operation&&JSON.parse(operation.canonicalIntent).payload.importHandle===handle;
 }
 async function currentPreview(previewId:string,sourceDigest:unknown){
   const {preview}=await query({kind:'preview',id:previewId});
   if(!preview||preview.expiresAtMs<=Date.now()||preview.sourceDigest!==sourceDigest)throw new Error('PROFILE_STALE');
   let observed;
   try{observed=await source.read(preview.sourcePath);}catch{throw new Error('PROFILE_STALE');}
   if(observed.identity!==preview.identity||observed.sourceDigest!==preview.sourceDigest)throw new Error('PROFILE_STALE');
   const {artifact}=await readBundle(preview.artifactId);
   if(artifact.sha256!==preview.artifactDigest)throw new Error('ARTIFACT_CORRUPT');
   return{preview,artifact};
 }
 async function bindSelection(prior:ProfileRecord,payload:Params){
   const current=await revision(prior,String(payload.revisionId)),doc=parseProfileDocument(current.document);
   const bound=parseProfileDocument({...doc,requiredRefs:payload.requiredRefs,recommendedRefs:payload.recommendedRefs});
   const dependencies=[];
   for(const ref of [...bound.requiredRefs,...bound.recommendedRefs]){
     const selected=await record(ref.entityId),rev=await revision(selected,ref.revisionId);
     if(selected.kind!=='SKILL'||selected.ownerProfileId&&selected.ownerProfileId!==prior.entityId||
       selected.projectId&&prior.projectId&&selected.projectId!==prior.projectId)throw new Error('PROFILE_CONFLICT');
     dependencies.push(version(selected,rev));
   }
   return{bound,dependencies};
 }
 return{
   select,preview,
   async prepare(action:string,payload:Params,expected:string|null,peer:AuthenticatedPeer){
     const {store}=await authorization.guard(peer);
     if(action==='skill.import'){
       const {preview}=await currentPreview(String(payload.previewId),payload.sourceDigest),p=await project(preview.projectId);
       const intent=makeIntent(store,action,randomUUID(),preview.projectId,null,p?.configRevision??null,
         {previewId:preview.previewId,sourceDigest:preview.sourceDigest,artifactDigest:preview.artifactDigest});
       return grant(peer,intent,{alias:preview.alias,scope:preview.scope,previewId:preview.previewId,sourceDigest:preview.sourceDigest,artifactDigest:preview.artifactDigest,
         permissions:preview.requiredPermissions});
     }
     if(action!=='skill.bind')throw new Error('UNSUPPORTED_VERSION');
     const prior=await record(String(payload.profileId)),p=await project(prior.projectId);
     if(prior.kind!=='PROFILE'||prior.stateRevision!==expected)throw new Error('PROFILE_STALE');
     const {bound}=await bindSelection(prior,payload);
     return grant(peer,makeIntent(store,action,prior.entityId,prior.projectId,expected,p?.configRevision??null,
       {revisionId:payload.revisionId,requiredRefs:bound.requiredRefs,recommendedRefs:bound.recommendedRefs}),
       {alias:prior.alias,scope:prior.scope,revisionId:prior.revisionId,requiredRefs:bound.requiredRefs,recommendedRefs:bound.recommendedRefs});
   },
   async write(action:string,params:Params,peer:AuthenticatedPeer){
     await authorization.guard(peer);
     const requestId=String(params.requestId),grantId=String(params.grantId);
     const saved=await originalWorkflowGrant(storage,requestId,grantId,action,'PROFILE');
     if(saved.operation)return{operation:publicProfileOperation(saved.operation)};
     const {intent}=saved,now=new Date().toISOString();
     if(action==='skill.import'){
       const {preview,artifact}=await currentPreview(String(intent.payload.previewId),intent.payload.sourceDigest);
       if(artifact.sha256!==intent.payload.artifactDigest)throw new Error('PROFILE_STALE');
       const value:ProfileRecord={entityId:intent.targetId!,kind:'SKILL',scope:preview.scope,projectId:preview.projectId,ownerProfileId:preview.ownerProfileId,
         alias:preview.alias,state:'REVIEWED',stateRevision:'1',revisionId:requestId,updatedAt:now};
       return save({kind:'record',admission:admit(requestId,intent,grantId),record:value,previewId:preview.previewId,
         revision:documentRevision(value,undefined,artifact,{sourceDigest:preview.sourceDigest,requiredPermissions:preview.requiredPermissions,provenance:'USER_REVIEWED'})});
     }
     if(action!=='skill.bind')throw new Error('UNSUPPORTED_VERSION');
     const prior=await record(intent.targetId!),{bound,dependencies}=await bindSelection(prior,intent.payload);
     const recordValue={...prior,revisionId:requestId,stateRevision:next(prior.stateRevision),updatedAt:now};
     return save({kind:'record',admission:admit(requestId,intent,grantId),record:recordValue,priorStateRevision:prior.stateRevision,
       dependencies,revision:documentRevision(recordValue,prior,null,{...bound})});
   },
 };
}
