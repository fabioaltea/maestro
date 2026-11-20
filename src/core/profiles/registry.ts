import {createHash,randomUUID} from 'node:crypto';
import {featureObject} from '../../domain/features/bundle.js';
import {PROFILE_LIMITS,profileTransition} from '../../domain/profiles/model.js';
import {intersectProfilePermissions,parseProfilePermissions,permitsProfilePermissions,type ProfilePermission} from '../../domain/profiles/permissions.js';
import {requireSkillSelection} from '../../domain/profiles/skills.js';
import {createProfileSkills} from './skills.js';
import {parseProfileDocument,type ProfileDocument} from '../../domain/profiles/resolve.js';
import {publicProfileOperation} from '../../protocol/profile.js';
import type {ProfileRecord,ProfileRevision,ProfileWrite} from '../../ports/profile.js';
import type {AuthenticatedPeer} from '../../ports/platform.js';
import type {WorkflowIntent} from '../../domain/workflow/authorization.js';
import {readSealedFeatureArtifact} from '../features/artifacts.js';
import {originalWorkflowGrant,workflowAdmission} from '../workflow/admission.js';
import {createWorkflowAuthorization} from '../workflow/authorization.js';
import type {ProfileAction} from './dispatch.js';
import type {ProfileRuntimeContext} from './runtime.js';

export const profileHash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const baseCapability={policyRevision:'1',allow:['WORKSPACE_READ'] as readonly ProfilePermission[],deny:[] as readonly ProfilePermission[]};
export const LOCAL_PROFILE_CAPABILITY={...baseCapability,digest:profileHash(baseCapability)};
type Params=Readonly<Record<string,unknown>>;
export function createProfileRegistry(context:ProfileRuntimeContext){
 const {storage,paths,instanceId}=context,authorization=createWorkflowAuthorization(context);
 const query=storage.readProfileState!.bind(storage);
 async function project(projectId:string|null){
   if(projectId===null)return null;
   const current=(await storage.getProject(projectId))?.project;
   if(!current||current.removedAt!==null)throw new Error('PROJECT_REMOVED');
   return current;
 }
 async function record(id:string){
   const {record}=await query({kind:'record',id});
   if(!record)throw new Error('PROFILE_NOT_FOUND');
   return record;
 }
 async function revision(record:ProfileRecord,expectedId=record.revisionId){
   if(!expectedId||record.revisionId!==expectedId||record.state==='DISABLED')throw new Error('PROFILE_STALE');
   const {revision}=await query({kind:'revision',id:expectedId});
   if(!revision||revision.entityId!==record.entityId)throw new Error('STATE_CORRUPT');
   return revision;
 }
 async function readBundle(id:string){
   const {artifact,text}=await readSealedFeatureArtifact(storage,id,'BUNDLE',PROFILE_LIMITS.artifactBytes,
     (await storage.readFeatureState!({kind:'artifact',id})).artifact?.targetId??undefined);
   let raw:unknown;
   try{raw=JSON.parse(text);}catch{throw new Error('INVALID_REQUEST');}
   return{artifact,raw};
 }
 function makeIntent(store:{storeId:string;ownerUid:number},action:string,targetId:string,projectId:string|null,
   expectedRevision:string|null,configRevision:string|null,payload:Params):WorkflowIntent{
   return{version:1,namespace:'PROFILE',action,storeId:store.storeId,ownerUid:store.ownerUid,targetId,projectId,expectedRevision,configRevision,payload};
 }
 async function grant(peer:AuthenticatedPeer,intent:WorkflowIntent,summary:Params){
   const saved=await authorization.prepare(peer,intent);
   return{grantId:saved.grantId,expiresAtMs:saved.expiresAtMs,canonicalIntentHash:createHash('sha256').update(saved.canonicalIntent).digest('hex'),
     summary:{action:intent.action,entityId:intent.targetId,projectId:intent.projectId,stateRevision:intent.expectedRevision,...summary}};
 }
 async function checkExisting(prior:ProfileRecord|undefined,expected:unknown,currentConfig:string|null){
   if(prior&&prior.stateRevision!==expected)throw new Error('PROFILE_STALE');
   const found=await project(prior?.projectId??null);
   if(currentConfig!==null&&found?.configRevision!==currentConfig)throw new Error('PROFILE_STALE');
 }
 async function approve(action:string,b:Params,expected:string|null,peer:AuthenticatedPeer){
   const {store}=await authorization.guard(peer);
   if(action==='disable'){
     const current=await record(String(b.targetId));
     await checkExisting(current,expected,null);profileTransition(current.kind,current.state,'disable');
     const p=await project(current.projectId);
     return grant(peer,makeIntent(store,action,current.entityId,current.projectId,expected,p?.configRevision??null,{revisionId:current.revisionId}),
       {alias:current.alias,scope:current.scope,revisionId:current.revisionId});
   }
   if(action!=='create'&&action!=='revise')throw new Error('UNSUPPORTED_VERSION');
   const current=action==='revise'?await record(String(b.profileId)):undefined;
   if(current){await checkExisting(current,expected,null);profileTransition(current.kind,current.state,'revise');}
   const projectId=current?current.projectId:typeof b.projectId==='string'?b.projectId:null,p=await project(projectId);
   const {artifact,raw}=await readBundle(String(b.bundleArtifactId)),document=parseProfileDocument(raw);
   if(current&&current.alias!==document.alias)throw new Error('PROFILE_CONFLICT');
   const scope=current?.scope??String(b.scope);
   const intent=makeIntent(store,action,current?.entityId??randomUUID(),projectId,expected,p?.configRevision??null,
     {scope,bundleArtifactId:artifact.artifactId,artifactDigest:artifact.sha256});
   return grant(peer,intent,{alias:document.alias,scope,artifactDigest:artifact.sha256,permissions:document.permissions});
 }
 async function write(action:string,params:Params,peer:AuthenticatedPeer){
   await authorization.guard(peer);
   const requestId=String(params.requestId),grantId=String(params.grantId);
   const original=await originalWorkflowGrant(storage,requestId,grantId,action,'PROFILE');
   if(original.operation)return{operation:publicProfileOperation(original.operation)};
   const {intent}=original;
   const previous=action==='create'?undefined:await record(intent.targetId!);
   if(previous)await checkExisting(previous,intent.expectedRevision,intent.configRevision);
   const at=new Date().toISOString();
   if(action==='disable'){
     if(!previous)throw new Error('PROFILE_NOT_FOUND');
     return save({kind:'record',admission:admit(requestId,intent,grantId),priorStateRevision:previous.stateRevision,
       record:{...previous,state:profileTransition(previous.kind,previous.state,'disable'),stateRevision:next(previous.stateRevision),updatedAt:at}});
   }
   const {artifact,raw}=await readBundle(String(intent.payload.bundleArtifactId)),document=parseProfileDocument(raw);
   if(artifact.sha256!==intent.payload.artifactDigest||previous&&previous.alias!==document.alias)throw new Error('PROFILE_STALE');
   const value:ProfileRecord={entityId:intent.targetId!,scope:intent.payload.scope as ProfileRecord['scope'],projectId:intent.projectId,
     kind:'PROFILE',ownerProfileId:null,alias:document.alias,state:'ENABLED',stateRevision:next(previous?.stateRevision??'0'),revisionId:requestId,updatedAt:at};
   return save({kind:'record',admission:admit(requestId,intent,grantId),record:value,...(previous?{priorStateRevision:previous.stateRevision}:{}),
     revision:documentRevision(value,previous,artifact,{...document})});
 }
 function admit(requestId:string,intent:WorkflowIntent,grantId:string|null){
   return workflowAdmission({requestId,intent,grantId,instanceId,nowMs:Date.now()});
 }
 async function save(change:ProfileWrite){
   const result=await storage.commitProfileState!(change);return{operation:publicProfileOperation(result.operation)};
 }
 async function existing(requestId:string,action:string,match:(intent:WorkflowIntent)=>boolean){
   const {operation}=await storage.readFeatureState!({kind:'operation',id:requestId});
   if(!operation)return null;
   const intent=JSON.parse(operation.canonicalIntent) as WorkflowIntent;
   if(intent.namespace!=='PROFILE'||intent.action!==action||!match(intent))throw new Error('IDEMPOTENCY_CONFLICT');
   return{operation:publicProfileOperation(operation)};
 }
 async function resolve(params:Params,peer:AuthenticatedPeer){
   const {store}=await authorization.guard(peer),requestId=String(params.requestId);
   const prior=await existing(requestId,'resolve',intent=>intent.targetId===params.profileId&&intent.projectId===params.projectId&&
     intent.payload.revisionId===params.revisionId&&intent.payload.providerCapabilityDigest===params.providerCapabilityDigest);
   if(prior)return prior;
   if(params.providerCapabilityDigest!==LOCAL_PROFILE_CAPABILITY.digest)throw new Error('CAPABILITY_UNAVAILABLE');
   const profile=await record(String(params.profileId)),projectId=String(params.projectId),p=await project(projectId);
   if(!p||profile.kind!=='PROFILE'||profile.projectId!==null&&profile.projectId!==projectId)throw new Error('PROFILE_NOT_FOUND');
   const profileRevision=await revision(profile,String(params.revisionId)),doc=parseProfileDocument(profileRevision.document);
   if(profileRevision.artifactId){
     const {artifact}=await readBundle(profileRevision.artifactId);
     if(artifact.sha256!==profileRevision.digest)throw new Error('ARTIFACT_CORRUPT');
   }
   const effectivePermissions=intersectProfilePermissions([baseCapability,doc.permissions]);
   if(!permitsProfilePermissions(effectivePermissions,doc.permissions.required))throw new Error('CAPABILITY_UNAVAILABLE');
   const selected=await resolveDependencies(doc,effectivePermissions,projectId,profile.entityId);
   if(profileRevision.byteLength+selected.byteLength>PROFILE_LIMITS.resolutionBytes)throw new Error('CONTEXT_LIMIT');
   const snapshot={schemaVersion:1,policyRevision:baseCapability.policyRevision,profileId:profile.entityId,profileRevisionId:profileRevision.revisionId,
     profileDigest:profileRevision.digest,projectId,projectRevision:p.configRevision,providerCapabilityDigest:LOCAL_PROFILE_CAPABILITY.digest,
     effectivePermissions,skills:selected.skills,tools:selected.tools,omitted:selected.omitted,validationRefs:doc.validationRefs,preferredProviders:doc.preferredProviders};
   const intent=makeIntent(store,'resolve',profile.entityId,projectId,profile.stateRevision,p.configRevision,
     {revisionId:profileRevision.revisionId,providerCapabilityDigest:LOCAL_PROFILE_CAPABILITY.digest});
   return save({kind:'resolution',admission:admit(requestId,intent,null),
     resolution:{resolutionId:requestId,profileId:profile.entityId,revisionId:profileRevision.revisionId,projectId,projectRevision:p.configRevision,
       capabilityDigest:LOCAL_PROFILE_CAPABILITY.digest,digest:profileHash(snapshot),snapshot,
       dependencyVersions:[version(profile,profileRevision),...selected.versions],createdAt:new Date().toISOString()}});
 }
 async function resolveDependencies(doc:ProfileDocument,permissions:readonly ProfilePermission[],projectId:string,profileId:string){
   const versions:ReturnType<typeof version>[]=[],skills:Record<string,unknown>[]=[],omitted:Record<string,unknown>[]=[];
   const aliases=new Set<string>();
   let byteLength=0;
   for(const [required,refs] of [[true,doc.requiredRefs],[false,doc.recommendedRefs]] as const){
     for(const ref of refs){
       try{
         const {record:selected}=await query({kind:'record',id:ref.entityId});
         if(!selected||selected.revisionId!==ref.revisionId)throw new Error('REQUIRED_SKILL_MISSING');
         const {records=[]}=await query({kind:'aliases',alias:selected.alias,projectId,ownerProfileId:profileId});
         requireSkillSelection(selected,records,projectId,profileId);
         if(aliases.has(selected.alias))throw new Error('PROFILE_CONFLICT');
         const skill=await revision(selected,ref.revisionId);
         if(!permitsProfilePermissions(permissions,parseProfilePermissions(skill.document.requiredPermissions)))throw new Error('PERMISSION_CONFLICT');
         if(!skill.artifactId||(await readBundle(skill.artifactId)).artifact.sha256!==skill.digest)throw new Error('ARTIFACT_CORRUPT');
         aliases.add(selected.alias);byteLength+=skill.byteLength;versions.push(version(selected,skill));
         skills.push({entityId:ref.entityId,revisionId:ref.revisionId,digest:skill.digest,alias:selected.alias,artifactId:skill.artifactId,required});
       }catch(error){
         if(required||(error as Error).message==='PROFILE_CONFLICT')throw error;
         const reason=['REQUIRED_SKILL_MISSING','PERMISSION_CONFLICT','ARTIFACT_CORRUPT'].includes((error as Error).message)?(error as Error).message:'REQUIRED_SKILL_MISSING';
         omitted.push({...ref,reason});
       }
     }
   }
   if(doc.toolRefs.length)throw new Error('TOOL_DISABLED');
   return{versions,skills,tools:[] as unknown[],omitted,byteLength};

 }
 return{context,authorization,query,project,record,revision,readBundle,makeIntent,grant,admit,save,existing,approve,write,resolve,checkExisting};
}

export function next(revision:string){return String(BigInt(revision)+1n);}
export function version(record:ProfileRecord,revision:ProfileRevision){return{entityId:record.entityId,stateRevision:record.stateRevision,revisionId:revision.revisionId};}
export function documentRevision(value:ProfileRecord,previous:ProfileRecord|undefined,
 artifact:{artifactId:string;sha256:string;expectedBytes:number}|null,document:Readonly<Record<string,unknown>>):ProfileRevision{
 return{revisionId:value.revisionId!,entityId:value.entityId,previousId:previous?.revisionId??null,digest:artifact?.sha256??profileHash(document),
   artifactId:artifact?.artifactId??null,byteLength:artifact?.expectedBytes??Buffer.byteLength(JSON.stringify(document)),document,createdAt:value.updatedAt};
}
export type ProfileRegistry=ReturnType<typeof createProfileRegistry>;
export function composeProfileServices(context:ProfileRuntimeContext):Readonly<Record<string,ProfileAction>>{
 const registry=createProfileRegistry(context),skills=createProfileSkills(registry);
 return{
   'profile.capabilities':async()=>({capability:LOCAL_PROFILE_CAPABILITY}),
   'profile.prepare':(params,peer)=>{
     const intent=featureObject(params.intent),expected=featureObject(params.expectedRevisions).stateRevision;
     const action=String(params.action),stateRevision=typeof expected==='string'?expected:null;
     return action.startsWith('skill.')?skills.prepare(action,intent,stateRevision,peer):registry.approve(action,intent,stateRevision,peer);
   },
   'profile.create':(params,peer)=>registry.write('create',params,peer),
   'profile.revise':(params,peer)=>registry.write('revise',params,peer),
   'profile.disable':(params,peer)=>registry.write('disable',params,peer),
   'profile.resolve':registry.resolve,
   'profile.skill.source':skills.select,
   'profile.skill.preview':skills.preview,
   'profile.skill.import':(params,peer)=>skills.write('skill.import',params,peer),
   'profile.skill.bind':(params,peer)=>skills.write('skill.bind',params,peer),
 };
}
