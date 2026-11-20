import type {Params} from './bridge-contract.ts';
import {keys,record,revision,text,uuid} from './input.ts';
import {CORE_ERRORS} from './core-errors.ts';

export const REVIEW_QUERIES=['listFeatureReviews','getFeatureReview','getReviewDiffPart','getReviewOperation'] as const;
export const REVIEW_MUTATIONS=['create','validate','request-changes'] as const;
export const REVIEW_BRIDGE_METHODS=[...REVIEW_QUERIES,'prepareReviewAction','confirmReviewAction','cancelReviewAction'] as const;
const ids=['reviewId','projectId','featureId','featureRevisionId','workspaceId','checkpointId'];
const statuses=['DRAFT','CHECKING','CHANGES_REQUESTED','READY_FOR_APPROVAL','BLOCKED','STALE','APPROVED'];
const oid=(v:unknown)=>{if(!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(text(v,64)))throw new Error('CLIENT_PROTOCOL_ERROR');};
const digest=(v:unknown)=>{if(!/^[a-f0-9]{64}$/.test(text(v,64)))throw new Error('CLIENT_PROTOCOL_ERROR');};
function integer(v:unknown,min:number,max:number){
 if(!Number.isSafeInteger(v)||Number(v)<min||Number(v)>max)throw new Error('CLIENT_PROTOCOL_ERROR');
}
function commandIds(value:unknown){
 if(!Array.isArray(value)||value.length<1||value.length>8||new Set(value.map(uuid)).size!==value.length)throw new Error('INVALID_INPUT');
 return value as string[];
}
function targetRef(value:unknown){
 const ref=text(value,266);
 if(!/^refs\/heads\/[A-Za-z0-9][A-Za-z0-9._/-]{0,255}$/.test(ref)||ref.includes('..')||ref.endsWith('.')||
    ref.split('/').some(part=>!part||part==='.'||part==='.git'||part.endsWith('.lock')))throw new Error('INVALID_INPUT');
 return ref;
}
export function reviewBridgeAction(value:unknown){
 const {action,...input}=record(value);
 if(action==='create'){
   keys(input,['projectId','featureId','checkpointId','targetRef','targetOid']);
   uuid(input.featureId);uuid(input.checkpointId);targetRef(input.targetRef);oid(input.targetOid);
 }else if(action==='validate'){
   keys(input,['projectId','reviewId','stateRevision','commandSpecIds']);
   uuid(input.reviewId);revision(input.stateRevision);commandIds(input.commandSpecIds);
 }else if(action==='request-changes'){
   keys(input,['projectId','reviewId','stateRevision','feedbackArtifactId']);
   uuid(input.reviewId);revision(input.stateRevision);uuid(input.feedbackArtifactId);
 }else throw new Error('INVALID_INPUT');
 uuid(input.projectId);
 return{action,input};
}
export function validateReviewBridge(method:string,p:Params){
 const base=['bridgeVersion','callId','selectionEpoch'];
 switch(method){
   case 'listFeatureReviews':keys(p,[...base,'projectId','cursor']);uuid(p.projectId);break;
   case 'getFeatureReview':keys(p,[...base,'reviewId','cursor']);uuid(p.reviewId);break;
   case 'getReviewDiffPart':keys(p,[...base,'artifactId','cursor']);uuid(p.artifactId);break;
   case 'getReviewOperation':keys(p,[...base,'requestId']);uuid(p.requestId);break;
   case 'prepareReviewAction':keys(p,[...base,'params']);reviewBridgeAction(p.params);break;
   case 'confirmReviewAction':case 'cancelReviewAction':keys(p,[...base,'confirmationId']);uuid(p.confirmationId);break;
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
function reviewOperation(value:unknown){
 const p=record(value);keys(p,['namespace','action','phase','outcome','requestId','targetId','acceptedAt','completedAt','result','error']);
 if(p.namespace!=='REVIEW'||!(REVIEW_MUTATIONS as readonly string[]).includes(String(p.action))||
    !['ACCEPTED','WORKING','FINALIZED'].includes(String(p.phase)))throw new Error('CLIENT_PROTOCOL_ERROR');
 uuid(p.requestId);uuid(p.targetId);
 const final=p.phase==='FINALIZED';
 if(final!==(p.completedAt!==null)||!(final?['SUCCEEDED','FAILED','BLOCKED','INTERRUPTED']:['IN_PROGRESS','UNKNOWN']).includes(String(p.outcome)))
   throw new Error('CLIENT_PROTOCOL_ERROR');
 for(const at of [p.acceptedAt,...(final?[p.completedAt]:[])])
   if(!Number.isFinite(Date.parse(text(at,64))))throw new Error('CLIENT_PROTOCOL_ERROR');
 if(p.result!==null){
   const result=record(p.result);keys(result,['reviewId','decisionId','digest','stateRevision','jobIds']);
   if(result.reviewId!==undefined)uuid(result.reviewId);
   if(result.decisionId!==undefined)uuid(result.decisionId);
   if(result.digest!==undefined)digest(result.digest);
   if(result.stateRevision!==undefined)revision(result.stateRevision);
   if(result.jobIds!==undefined)commandIds(result.jobIds);
 }
 if(p.error===null)return p;
 const error=record(p.error),code=text(error.code,64);
 if(!Object.hasOwn(CORE_ERRORS,code))throw new Error('CLIENT_PROTOCOL_ERROR');
 return{...p,error:CORE_ERRORS[code as keyof typeof CORE_ERRORS]};
}
export function validateReviewData(action:string,value:unknown,params:Params){
 const p=record(value);
 if(new TextEncoder().encode(JSON.stringify(p)).length>32768)throw new Error('CLIENT_PROTOCOL_ERROR');
 const meta=['storeId','freshness','observabilityDegraded'];
 if(p.storeId!==undefined)uuid(p.storeId);
 if(action==='prepare'){
   keys(p,[...meta,'grantId','canonicalIntentHash','summary','expiresAt']);uuid(p.grantId);digest(p.canonicalIntentHash);
   integer(p.expiresAt,1,Number.MAX_SAFE_INTEGER);record(p.summary);return p;
 }
 if(action==='operation'||(REVIEW_MUTATIONS as readonly string[]).includes(action)){
   keys(p,[...meta,'operation','accepted','requestId','entityId','stateRevision','jobIds','code','error']);
   if(p.operation!==undefined){
     const operation=reviewOperation(p.operation);
     if(params.requestId!==undefined&&operation.requestId!==params.requestId||action!=='operation'&&operation.action!==action)
       throw new Error('CLIENT_PROTOCOL_ERROR');
     return{...(p.storeId?{storeId:p.storeId}:{}),operation};
   }
   if(p.accepted===true){
     uuid(p.requestId);uuid(p.entityId);revision(p.stateRevision);commandIds(p.jobIds);
     return{accepted:true,requestId:p.requestId,entityId:p.entityId,stateRevision:p.stateRevision,jobIds:p.jobIds};
   }
   return{};
 }
 if(!['CURRENT','LAST_KNOWN'].includes(String(p.freshness)))throw new Error('CLIENT_PROTOCOL_ERROR');
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
