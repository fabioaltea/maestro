import {randomUUID} from 'node:crypto';
import {parseToolManifest,requireToolEnable} from '../../domain/profiles/tools.js';
import {profileTransition} from '../../domain/profiles/model.js';
import {appliesProfileScope} from '../../domain/profiles/skills.js';
import {parseProfilePermissions,permitsProfilePermissions} from '../../domain/profiles/permissions.js';
import {parseProfileDocument} from '../../domain/profiles/resolve.js';
import {publicProfileOperation} from '../../protocol/profile.js';
import type {ProfileRecord} from '../../ports/profile.js';
import type {AuthenticatedPeer} from '../../ports/platform.js';
import {originalWorkflowGrant} from '../workflow/admission.js';
import {documentRevision,next,type ProfileRegistry} from './registry.js';

type Params=Readonly<Record<string,unknown>>;
export function createProfileTools(registry:ProfileRegistry){
 const {context:{storage},authorization,project,record,revision,readBundle,makeIntent,grant,admit,save,query}=registry;
 async function inspect(artifactId:string,sourceDigest:unknown){
   const {artifact,raw}=await readBundle(artifactId);
   if(artifact.sha256!==sourceDigest)throw new Error('PROFILE_STALE');
   return{artifact,manifest:parseToolManifest(raw)};
 }
 async function enable(prior:ProfileRecord,revisionId:string,permissions:unknown){
   profileTransition(prior.kind,prior.state,'enable');
   const current=await revision(prior,revisionId);
   if(!current.artifactId)throw new Error('ARTIFACT_CORRUPT');
   const {artifact,manifest}=await inspect(current.artifactId,current.digest);
   return{artifact,manifest,permissions:requireToolEnable(manifest,permissions)};
 }
 return{
   async prepare(action:string,payload:Params,expected:string|null,peer:AuthenticatedPeer){
     const {store}=await authorization.guard(peer);
     if(action==='tool.import'){
       const {artifact,manifest}=await inspect(String(payload.manifestArtifactId),payload.sourceDigest),p=await project(manifest.projectId);
       const intent=makeIntent(store,action,randomUUID(),manifest.projectId,null,p?.configRevision??null,
         {manifestArtifactId:artifact.artifactId,sourceDigest:artifact.sha256});
       return grant(peer,intent,{alias:manifest.alias,scope:manifest.scope,kind:manifest.kind,sourceDigest:artifact.sha256,permissions:manifest.requiredPermissions});
     }
     if(action!=='tool.enable')throw new Error('UNSUPPORTED_VERSION');
     const prior=await record(String(payload.toolId)),p=await project(prior.projectId);
     if(prior.stateRevision!==expected)throw new Error('PROFILE_STALE');
     const observed=await enable(prior,String(payload.revisionId),payload.permissions);
     const intent=makeIntent(store,action,prior.entityId,prior.projectId,expected,p?.configRevision??null,
       {revisionId:prior.revisionId,sourceDigest:observed.artifact.sha256,permissions:observed.permissions});
     return grant(peer,intent,{alias:prior.alias,scope:prior.scope,kind:observed.manifest.kind,revisionId:prior.revisionId,permissions:observed.permissions});
   },
   async write(action:string,params:Params,peer:AuthenticatedPeer){
     await authorization.guard(peer);
     const requestId=String(params.requestId),grantId=String(params.grantId);
     const original=await originalWorkflowGrant(storage,requestId,grantId,action,'PROFILE');
     if(original.operation)return{operation:publicProfileOperation(original.operation)};
     const {intent}=original,admission=admit(requestId,intent,grantId),updatedAt=new Date().toISOString();
     if(action==='tool.import'){
       const {artifact,manifest}=await inspect(String(intent.payload.manifestArtifactId),intent.payload.sourceDigest);
       const value:ProfileRecord={entityId:intent.targetId!,kind:'TOOL',scope:manifest.scope,projectId:manifest.projectId,ownerProfileId:null,
         alias:manifest.alias,state:'REVIEWED',stateRevision:'1',revisionId:requestId,updatedAt};
       return save({kind:'record',admission,record:value,revision:documentRevision(value,undefined,artifact,{...manifest,sourceDigest:artifact.sha256,provenance:'USER_REVIEWED'})});
     }
     if(action!=='tool.enable')throw new Error('UNSUPPORTED_VERSION');
     const prior=await record(intent.targetId!);
     if(prior.stateRevision!==intent.expectedRevision)throw new Error('PROFILE_STALE');
     const {artifact,manifest,permissions}=await enable(prior,String(intent.payload.revisionId),intent.payload.permissions);
     if(artifact.sha256!==intent.payload.sourceDigest)throw new Error('PROFILE_STALE');
     const value={...prior,state:'ENABLED' as const,stateRevision:next(prior.stateRevision),revisionId:requestId,updatedAt};
     return save({kind:'record',admission,record:value,priorStateRevision:prior.stateRevision,
       revision:documentRevision(value,prior,artifact,{...manifest,sourceDigest:artifact.sha256,enabledPermissions:permissions,provenance:'USER_REVIEWED'})});
   },
   async suggest(params:Params,peer:AuthenticatedPeer){
     await authorization.guard(peer);
     const projectId=String(params.projectId),p=await project(projectId),profile=await record(String(params.profileId));
     if(!p||!appliesProfileScope(profile,projectId,profile.entityId)||profile.kind!=='PROFILE')throw new Error('PROFILE_NOT_FOUND');
     const doc=parseProfileDocument((await revision(profile)).document),permissions=registry.effective(profile,doc);
     const used=new Set([...doc.requiredRefs,...doc.recommendedRefs,...doc.toolRefs].map(ref=>ref.entityId)),suggestions=[];
     for(const kind of ['SKILL','TOOL'] as const){
       for(let offset:number|null=0;offset!==null&&suggestions.length<20;){
         const page=await query({kind:'list',entityKind:kind,projectId,offset});
         for(const candidate of page.records??[]){
           if(used.has(candidate.entityId)||candidate.state!==(kind==='SKILL'?'REVIEWED':'ENABLED')||!appliesProfileScope(candidate,projectId,profile.entityId))continue;
           const rev=await revision(candidate),required=parseProfilePermissions(rev.document.requiredPermissions);
           if(!permitsProfilePermissions(permissions,required))continue;
           if(kind==='SKILL'){
             const {records=[]}=await query({kind:'aliases',alias:candidate.alias,projectId,ownerProfileId:profile.entityId});
             if(records.some(item=>item.entityId!==candidate.entityId&&item.state!=='DISABLED'&&item.scope!==candidate.scope))continue;
           }
           suggestions.push({entityId:candidate.entityId,revisionId:rev.revisionId,alias:candidate.alias,kind,reason:'PERMISSIONS_COMPATIBLE'});
           if(suggestions.length>=20)break;
         }
         offset=page.nextOffset??null;
       }
     }
     return{suggestions};
   },
 };
}
