import type {Params} from './bridge-contract.ts';
import {keys,record,revision,text,uuid} from './input.ts';

export const REVIEW_BRIDGE_METHODS=['listFeatureReviews','getFeatureReview','getReviewDiffPart'] as const;
const ids=['reviewId','projectId','featureId','featureRevisionId','workspaceId','checkpointId'];
const statuses=['DRAFT','CHECKING','CHANGES_REQUESTED','READY_FOR_APPROVAL','BLOCKED','STALE','APPROVED'];
const oid=(v:unknown)=>{if(!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(text(v,64)))throw new Error('CLIENT_PROTOCOL_ERROR');};
const digest=(v:unknown)=>{if(!/^[a-f0-9]{64}$/.test(text(v,64)))throw new Error('CLIENT_PROTOCOL_ERROR');};
function integer(v:unknown,min:number,max:number){
 if(!Number.isSafeInteger(v)||Number(v)<min||Number(v)>max)throw new Error('CLIENT_PROTOCOL_ERROR');
}
export function validateReviewBridge(method:string,p:Params){
 const base=['bridgeVersion','callId','selectionEpoch'];
 switch(method){
   case 'listFeatureReviews':keys(p,[...base,'projectId','cursor']);uuid(p.projectId);break;
   case 'getFeatureReview':keys(p,[...base,'reviewId','cursor']);uuid(p.reviewId);break;
   case 'getReviewDiffPart':keys(p,[...base,'artifactId','cursor']);uuid(p.artifactId);break;
   default:throw new Error('INVALID_INPUT');
 }
 if(p.cursor!==undefined)text(p.cursor,1024);
}
function review(value:unknown,withParts:boolean){
 const row=record(value);
 keys(row,[...ids,'sourceOid','sourceTreeOid','targetRef','targetOid','digest','state','stateRevision','createdAt','fileCount','diffBytes',
   ...(withParts?['parts']:[])]);
 for(const key of ids)uuid(row[key]);
 for(const key of ['sourceOid','sourceTreeOid','targetOid'])oid(row[key]);
 if(!/^refs\/heads\/[A-Za-z0-9][A-Za-z0-9._/-]{0,255}$/.test(text(row.targetRef,266))||!statuses.includes(String(row.state)))
   throw new Error('CLIENT_PROTOCOL_ERROR');
 digest(row.digest);revision(row.stateRevision);text(row.createdAt,64);
 integer(row.fileCount,0,100);integer(row.diffBytes,0,2097152);
 if(withParts){
   if(!Array.isArray(row.parts)||row.parts.length>8)throw new Error('CLIENT_PROTOCOL_ERROR');
   let total=0;
   for(const item of row.parts){
     const part=record(item);keys(part,['artifactId','sha256','bytes']);uuid(part.artifactId);digest(part.sha256);integer(part.bytes,1,262144);
     total+=Number(part.bytes);
   }
   if(total!==row.diffBytes)throw new Error('CLIENT_PROTOCOL_ERROR');
 }
 return row;
}
export function validateReviewData(action:string,value:unknown,params:Params){
 const p=record(value);
 if(new TextEncoder().encode(JSON.stringify(p)).length>32768)throw new Error('CLIENT_PROTOCOL_ERROR');
 if(!['CURRENT','LAST_KNOWN'].includes(String(p.freshness)))throw new Error('CLIENT_PROTOCOL_ERROR');
 const meta=['storeId','freshness','observabilityDegraded'];
 if(p.storeId!==undefined)uuid(p.storeId);
 if(action==='list'){
   keys(p,[...meta,'items','nextCursor']);
   if(!Array.isArray(p.items)||p.items.length>20||p.items.some(item=>review(item,false).projectId!==params.projectId))throw new Error('CLIENT_PROTOCOL_ERROR');
 }else if(action==='get'){
   keys(p,[...meta,'review','eligibility','criteria','nextCursor']);
   if(review(p.review,true).reviewId!==params.reviewId||p.eligibility!=='UNKNOWN')throw new Error('CLIENT_PROTOCOL_ERROR');
   if(p.criteria!==undefined){
     if(!Array.isArray(p.criteria)||p.criteria.length>20)throw new Error('CLIENT_PROTOCOL_ERROR');
     for(const value of p.criteria){
       const item=record(value);keys(item,['criterionId','storyId','required','text','verification','status','evidence']);
       for(const id of ['criterionId','storyId'])
         if(!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(text(item[id],64)))throw new Error('CLIENT_PROTOCOL_ERROR');
       if(typeof item.required!=='boolean'||!['PASS','FAIL','NOT_RUN','BLOCKED'].includes(String(item.status)))throw new Error('CLIENT_PROTOCOL_ERROR');
       for(const field of ['text','verification'])if(item[field]!==null)text(item[field],4096);
       if(item.evidence!==undefined){
         const evidence=record(item.evidence);
         keys(evidence,['criterionId','jobId','treeOid','commandDigest','outputId','status','checkedAt']);
         if(evidence.criterionId!==item.criterionId||evidence.status!==item.status)throw new Error('CLIENT_PROTOCOL_ERROR');
         if(evidence.jobId!==null)uuid(evidence.jobId);
         if(evidence.outputId!==null)uuid(evidence.outputId);
         oid(evidence.treeOid);digest(evidence.commandDigest);text(evidence.checkedAt,64);
       }
     }
   }
 }else if(action==='artifact'){
   keys(p,[...meta,'artifactId','sha256','totalBytes','offset','base64','nextCursor']);
   if(uuid(p.artifactId)!==params.artifactId)throw new Error('CLIENT_PROTOCOL_ERROR');
   digest(p.sha256);integer(p.totalBytes,1,262144);integer(p.offset,0,Number(p.totalBytes)-1);
   const base64=text(p.base64,10924),decoded=atob(base64);
   if(btoa(decoded)!==base64||decoded.length<1||decoded.length>8192||Number(p.offset)+decoded.length>Number(p.totalBytes))
     throw new Error('CLIENT_PROTOCOL_ERROR');
 }else throw new Error('CLIENT_PROTOCOL_ERROR');
 if(p.nextCursor!=null)text(p.nextCursor,1024);
 return p;
}
