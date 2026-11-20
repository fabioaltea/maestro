import {featureFields,featureObject} from '../../domain/features/bundle.js';
import type {StoragePort} from '../../ports/storage.js';
import {publicReviewOperation,requireReviewEnvelope,validateReviewParams} from '../../protocol/review.js';
import {readReviewCriteria,reviewEvidenceDigest} from './criteria.js';

const CRITERIA_PAGE_BYTES=20000;

const encode=(data:unknown)=>Buffer.from(JSON.stringify(data)).toString('base64url');
export function createReviewReader({storage,storeId,offline}:{storage:StoragePort;storeId:string;offline:boolean}){
 return async(method:string,p:Readonly<Record<string,unknown>>):Promise<Record<string,unknown>>=>{
   validateReviewParams(method,p);
   const query=storage.readReviewState?.bind(storage);
   if(!query||!storage.readFeatureState)throw new Error('REVIEW_NOT_INITIALIZED');
   function cursor(target:string){
     if(p.cursor===undefined)return null;
     let data:Record<string,unknown>;
     try{
       data=featureObject(JSON.parse(Buffer.from(String(p.cursor),'base64url').toString()));
       featureFields(data,['storeId','method','target','revision','offset']);
       if(encode(data)!==p.cursor||!Number.isSafeInteger(data.offset)||Number(data.offset)<1)throw new Error();
     }catch{throw new Error('INVALID_REQUEST');}
     if(data.storeId!==storeId)throw new Error('WRONG_STORE');
     if(data.method!==method||data.target!==target)throw new Error('REVISION_CONFLICT');
     return{offset:Number(data.offset),revision:data.revision};
   }
   const next=(target:string,revision:string|undefined,offset:number)=>encode({storeId,method,target,revision,offset});
   let result:Record<string,unknown>;
   if(method==='review.operation.get'){
     const requestId=String(p.requestId),{operation}=await storage.readFeatureState({kind:'operation',id:requestId});
     if(!operation)throw new Error('OPERATION_NOT_FOUND');
     result={operation:publicReviewOperation(operation)};
     if(operation.action==='integrate'){
       const {integration}=await query({kind:'integration',id:requestId});
       if(integration)result.integration={integrationId:requestId,phase:integration.phase,resultingOid:integration.resultingOid,proof:integration.proof};
     }
   }else if(method==='review.get'){
     const reviewId=String(p.reviewId),page=cursor(reviewId);
     const {review}=await query({kind:'review',id:reviewId});
     if(!review)throw new Error('OPERATION_NOT_FOUND');
     if(page&&page.revision!==review.stateRevision)throw new Error('REVISION_CONFLICT');
     const [all,{evidence=[]},{candidate}]=await Promise.all([readReviewCriteria(storage,review),
       review.state==='CHECKING'?Promise.resolve({evidence:[]}):query({kind:'evidence',id:reviewId}),query({kind:'current-candidate',id:reviewId})]);
     const data:Record<string,unknown>={};
     if(candidate){
       const [{decision},{integration}]=await Promise.all([query({kind:'current-decision',id:candidate.candidateId}),
         query({kind:'candidate-integration',id:candidate.candidateId})]);
       data.candidate=candidate;data.evidenceDigest=reviewEvidenceDigest(evidence);data.decisionId=decision?.decisionId??null;
       data.integration=integration?{integrationId:integration.integrationId,phase:integration.phase,resultingOid:integration.resultingOid}:null;
     }
     const criteria=[];
     let offset=page?.offset??0,bytes=0;
     if(page&&offset>=all.length)throw new Error('INVALID_REQUEST');
     for(const criterion of all.slice(offset,offset+20)){
       // JSON escaping can expand control characters in a single large criterion.
       const proof=evidence.find(value=>value.criterionId===criterion.criterionId);
       const item={criterionId:criterion.criterionId,storyId:criterion.storyId,required:criterion.required,
         text:criterion.text,verification:criterion.verification,status:proof?.status??'NOT_RUN',...(proof?{evidence:proof}:{})};
       const size=Buffer.byteLength(JSON.stringify(item))+1;
       if(bytes+size>CRITERIA_PAGE_BYTES){
         if(criteria.length)break;
         criteria.push({...item,text:null,verification:null});
         offset++;
         break;
       }
       criteria.push(item);bytes+=size;offset++;
     }
     result={review,eligibility:'UNKNOWN',criteria,...data,
       nextCursor:offset<all.length?next(reviewId,review.stateRevision,offset):null};
   }else if(method==='review.list'){
     const projectId=String(p.projectId),page=cursor(projectId),r=await query({kind:'list',projectId,offset:page?.offset??0,limit:Number(p.limit??20)});
     if(page&&page.revision!==r.revision)throw new Error('REVISION_CONFLICT');
     result={items:(r.reviews??[]).map(({parts:_,...item})=>item),nextCursor:r.nextOffset==null?null:next(projectId,r.revision,r.nextOffset)};
   }else if(method==='review.artifact.get'){
     const artifactId=String(p.artifactId),page=cursor(artifactId),{artifact}=await query({kind:'artifact',id:artifactId});
     if(!artifact||!storage.readWorkflowArtifact)throw new Error('ARTIFACT_CORRUPT');
     if(page&&page.revision!==artifact.sha256)throw new Error('REVISION_CONFLICT');
     const offset=page?.offset??0;
     if(offset>=artifact.bytes)throw new Error('INVALID_REQUEST');
     const chunk=await storage.readWorkflowArtifact(artifactId,offset,8192);
     if(chunk.sha256!==artifact.sha256||chunk.totalBytes!==artifact.bytes||chunk.bytes.length<1||chunk.bytes.length>8192)
       throw new Error('ARTIFACT_CORRUPT');
     const end=offset+chunk.bytes.length;
     result={artifactId,sha256:artifact.sha256,totalBytes:artifact.bytes,offset,base64:Buffer.from(chunk.bytes).toString('base64'),
       nextCursor:end<artifact.bytes?next(artifactId,artifact.sha256,end):null};
   }else throw new Error('UNSUPPORTED_VERSION');
   const reply={...result,freshness:offline?'LAST_KNOWN':'CURRENT'};
   requireReviewEnvelope(reply);return reply;
 };
}
