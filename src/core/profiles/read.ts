import type {StoragePort} from '../../ports/storage.js';
import type {ProfileKind} from '../../domain/profiles/model.js';
import type {ProfilePreview,ProfileResolution,ProfileRevision} from '../../ports/profile.js';
import {featureObject} from '../../domain/features/bundle.js';
import {publicProfileOperation,requireProfileEnvelope,validateProfileParams} from '../../protocol/profile.js';

const encode=(value:unknown)=>Buffer.from(JSON.stringify(value)).toString('base64url');
function cursor(value:unknown){
 if(value===undefined)return null;
 try{return featureObject(JSON.parse(Buffer.from(String(value),'base64url').toString('utf8')));}
 catch{throw new Error('INVALID_REQUEST');}
}
export function profilePreviewSummary(preview:ProfilePreview){
 const {sourcePath:_path,identity:_identity,artifactDigest:_artifactDigest,...summary}=preview;
 return{...summary,provenance:'UNKNOWN'};
}
export function profileRevisionSummary(revision:ProfileRevision){
 const {document,...meta}=revision;
 const allowed=['title','role','preferredProviders','permissions','requiredPermissions','requiredRefs','recommendedRefs','toolRefs','validationRefs',
   'kind','endpointRef','commandSpecId','networkScope','sourceDigest','provenance','enabledPermissions','minRuntime'];
 const summary=Object.fromEntries(allowed.filter(key=>Object.hasOwn(document,key)).map(key=>[key,document[key]]));
 return{...meta,document:summary};
}
export async function isCurrentProfileResolution(storage:StoragePort,resolution:ProfileResolution){
 const project=(await storage.getProject(resolution.projectId))?.project;
 if(!project||project.removedAt!==null||project.configRevision!==resolution.projectRevision)return false;
 for(const dependency of resolution.dependencyVersions){
   const {record}=await storage.readProfileState!({kind:'record',id:dependency.entityId});
   if(!record||record.state==='DISABLED'||record.revisionId!==dependency.revisionId||record.stateRevision!==dependency.stateRevision)return false;
 }
 return true;
}
export function createProfileReader(options:{storage:StoragePort;storeId:string;offline:boolean}){
 const {storage,storeId,offline}=options,query=storage.readProfileState?.bind(storage),freshness=offline?'LAST_KNOWN':'CURRENT';
 return async (method:string,params:Readonly<Record<string,unknown>>):Promise<Record<string,unknown>>=>{
   validateProfileParams(method,params);
   if(!query||!storage.readFeatureState)throw new Error('PROFILE_NOT_INITIALIZED');
   const after=cursor(params.cursor);
   if(after&&after.storeId!==storeId)throw new Error('WRONG_STORE');
   let data:Record<string,unknown>;
   switch(method){
     case 'profile.list':{
       const projectId=typeof params.projectId==='string'?params.projectId:null,kind=params.kind as ProfileKind;
       const offset=after?.offset??0;
       if(typeof offset!=='number'||!Number.isSafeInteger(offset)||offset<0)throw new Error('INVALID_REQUEST');
       if(after&&(after.kind!==kind||after.projectId!==projectId||Object.keys(after).length!==5))throw new Error('REVISION_CONFLICT');
       const result=await query({kind:'list',entityKind:kind,projectId,offset,limit:Number(params.limit??20)});
       if(after&&result.storeRevision!==after.revision)throw new Error('REVISION_CONFLICT');
       data={items:result.records,nextCursor:result.nextOffset===null?null:
         encode({kind,projectId,storeId,revision:result.storeRevision,offset:result.nextOffset})};break;
     }
     case 'profile.get':{
       const {record}=await query({kind:'record',id:String(params.entityId)});
       if(!record)throw new Error('PROFILE_NOT_FOUND');
       const revisionId=params.revisionId??record.revisionId;
       const revision=revisionId?(await query({kind:'revision',id:String(revisionId)})).revision:null;
       if(revisionId&&(!revision||revision.entityId!==record.entityId))throw new Error('PROFILE_NOT_FOUND');
       data={record,revision:revision?profileRevisionSummary(revision):null};break;
     }
     case 'profile.resolution.get':{
       const {resolution}=await query({kind:'resolution',id:String(params.resolutionId)});
       if(!resolution)throw new Error('PROFILE_NOT_FOUND');
       data={resolution,currentness:offline?'UNKNOWN':await isCurrentProfileResolution(storage,resolution)?'CURRENT':'STALE'};break;
     }
     case 'profile.skill.preview.get':{
       const {preview}=await query({kind:'preview',id:String(params.previewId)});
       if(!preview)throw new Error('PROFILE_NOT_FOUND');
       data={preview:profilePreviewSummary(preview)};break;
     }
     case 'profile.operation.get':{
       const {operation}=await storage.readFeatureState({kind:'operation',id:String(params.requestId)});
       if(!operation)throw new Error('OPERATION_NOT_FOUND');
       data={operation:publicProfileOperation(operation)};break;
     }
     case 'profile.artifact.get':{
       const artifactId=String(params.artifactId),{artifact}=await query({kind:'artifact',id:artifactId});
       if(!artifact||!storage.readWorkflowArtifact)throw new Error('ARTIFACT_CORRUPT');
       if(after&&(after.kind!=='artifact'||after.artifactId!==artifactId||after.sha256!==artifact.sha256||Object.keys(after).length!==5))
         throw new Error('REVISION_CONFLICT');
       const offset=after?.offset??0;
       if(typeof offset!=='number'||!Number.isSafeInteger(offset)||offset<0||offset>=artifact.bytes)throw new Error('INVALID_REQUEST');
       const chunk=await storage.readWorkflowArtifact(artifactId,offset,8192);
       if(chunk.sha256!==artifact.sha256||chunk.totalBytes!==artifact.bytes)throw new Error('ARTIFACT_CORRUPT');
       const next=offset+chunk.bytes.length;
       data={artifactId,sha256:chunk.sha256,totalBytes:chunk.totalBytes,offset,base64:Buffer.from(chunk.bytes).toString('base64'),
         nextCursor:next<chunk.totalBytes?encode({kind:'artifact',storeId,artifactId,sha256:artifact.sha256,offset:next}):null};break;
     }
     default:throw new Error('UNSUPPORTED_VERSION');
   }
   const result={...data,freshness};requireProfileEnvelope(result);return result;
 };
}
