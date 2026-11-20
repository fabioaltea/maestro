import {featureFields,featureObject,featureText} from '../domain/features/bundle.js';
import {REVIEW_GRANTED,reviewOid,reviewTargetRef} from '../domain/review/state.js';
import {foundationError,type ErrorCode} from '../domain/errors.js';
import type {WorkflowOperationRecord} from '../ports/workflow.js';
import {requireFeatureEnvelope} from './feature.js';
import {workspaceRevision,workspaceUuid} from './workspace.js';

export const requireReviewEnvelope=requireFeatureEnvelope;
export const REVIEW_READ_METHODS=['review.list','review.get','review.artifact.get','review.operation.get'] as const;
export const REVIEW_MUTATIONS=[...REVIEW_GRANTED,'complete'].map(action=>`review.${action}`);
export const REVIEW_METHODS=[...REVIEW_READ_METHODS,...REVIEW_MUTATIONS,'review.prepare','review.receipt.get','review.cleanup.preview'];
export const reviewMutation=(method:string)=>REVIEW_MUTATIONS.includes(method);
function commandIds(value:unknown){
 if(!Array.isArray(value)||!value.length||value.length>8||new Set(value.map(workspaceUuid)).size!==value.length)throw new Error('INVALID_REQUEST');
}
export function validateReviewParams(method:string,value:unknown){
 const p=featureObject(value);requireReviewEnvelope(p);
 if(method==='review.complete'){
   featureFields(p,['requestId','integrationId','expectedStateRevision']);workspaceUuid(p.requestId);workspaceUuid(p.integrationId);
   workspaceRevision(p.expectedStateRevision);return;
 }
 if(reviewMutation(method)){
   featureFields(p,['requestId','grantId']);workspaceUuid(p.requestId);workspaceUuid(p.grantId);return;
 }
 switch(method){
   case 'review.list':
     featureFields(p,['projectId'],['cursor','limit']);workspaceUuid(p.projectId);
     if(p.limit!==undefined&&(!Number.isInteger(p.limit)||Number(p.limit)<1||Number(p.limit)>20))throw new Error('INVALID_REQUEST');
     break;
   case 'review.get':
     featureFields(p,['reviewId'],['cursor']);workspaceUuid(p.reviewId);break;
   case 'review.artifact.get':
     featureFields(p,['artifactId'],['cursor']);workspaceUuid(p.artifactId);break;
   case 'review.operation.get':
     featureFields(p,['requestId']);workspaceUuid(p.requestId);break;
   case 'review.receipt.get':
     featureFields(p,['integrationId']);workspaceUuid(p.integrationId);break;
   case 'review.cleanup.preview':
     featureFields(p,['integrationId','workspaceId']);workspaceUuid(p.integrationId);workspaceUuid(p.workspaceId);break;
   case 'review.prepare':{
     featureFields(p,['action','intent','expectedRevisions']);
     const i=featureObject(p.intent),r=featureObject(p.expectedRevisions);
     if(p.action==='create'){
       featureFields(i,['featureId','checkpointId','targetRef','targetOid']);featureFields(r,[]);
       workspaceUuid(i.featureId);workspaceUuid(i.checkpointId);reviewTargetRef(i.targetRef);reviewOid(i.targetOid);
     }else if(p.action==='request-changes'){
       featureFields(i,['reviewId','feedbackArtifactId']);featureFields(r,['stateRevision']);
       workspaceUuid(i.reviewId);workspaceUuid(i.feedbackArtifactId);workspaceRevision(r.stateRevision);
     }else if(p.action==='validate'){
       featureFields(i,['reviewId','commandSpecIds']);featureFields(r,['stateRevision']);
       workspaceUuid(i.reviewId);commandIds(i.commandSpecIds);workspaceRevision(r.stateRevision);
     }else if(p.action==='candidate.prepare'){
       featureFields(i,['reviewId','expectedStateRevision']);featureFields(r,['stateRevision']);
       workspaceUuid(i.reviewId);workspaceRevision(r.stateRevision);
       if(i.expectedStateRevision!==r.stateRevision)throw new Error('INVALID_REQUEST');
     }else if(p.action==='approve'){
       featureFields(i,['reviewId','candidateId','evidenceDigest']);featureFields(r,['stateRevision']);
       workspaceUuid(i.reviewId);workspaceUuid(i.candidateId);workspaceRevision(r.stateRevision);
       if(typeof i.evidenceDigest!=='string'||!/^[a-f0-9]{64}$/.test(i.evidenceDigest))throw new Error('INVALID_REQUEST');
     }else if(p.action==='integrate'){
       featureFields(i,['candidateId','decisionId','expectedTargetOid']);featureFields(r,['stateRevision']);
       workspaceUuid(i.candidateId);workspaceUuid(i.decisionId);workspaceRevision(r.stateRevision);reviewOid(i.expectedTargetOid);
     }else throw new Error('UNSUPPORTED_VERSION');
     break;
   }
   default:throw new Error('UNSUPPORTED_VERSION');
 }
 if(p.cursor!==undefined)featureText(p.cursor,1024,true);
}
const resultKeys=['reviewId','jobIds','decisionId','candidateId','candidateOid','integrationId','receiptId','digest','stateRevision','resultingOid'] as const;
export function publicReviewOperation(o:WorkflowOperationRecord){
 const {namespace,action,phase,outcome,requestId,targetId,acceptedAt,completedAt,result,error}=o;
 if(namespace!=='REVIEW')throw new Error('OPERATION_NOT_FOUND');
 return{namespace,action,phase,outcome,requestId,targetId,acceptedAt,completedAt,
   result:result===null?null:Object.fromEntries(resultKeys.filter(key=>Object.hasOwn(result,key)).map(key=>[key,result[key]])),
   error:error===null?null:foundationError(error as ErrorCode,{operationId:requestId,persisted:true})};
}
export function decodeReviewOperation(value:unknown){
 const p=featureObject(value);
 featureFields(p,['namespace','action','phase','outcome','requestId','targetId','acceptedAt','completedAt','result','error']);
 const requestId=workspaceUuid(p.requestId);
 if(p.targetId!==null)workspaceUuid(p.targetId);
 if(p.namespace!=='REVIEW'||![...REVIEW_GRANTED,'complete'].includes(String(p.action))||
    !['ACCEPTED','WORKING','FINALIZED'].includes(String(p.phase)))throw new Error('INVALID_REQUEST');
 const terminal=p.phase==='FINALIZED';
 if(terminal!==(p.completedAt!==null)||[p.acceptedAt,...(terminal?[p.completedAt]:[])].some(at=>typeof at!=='string'||!Number.isFinite(Date.parse(at)))||
    !(terminal?['SUCCEEDED','FAILED','BLOCKED','INTERRUPTED']:['IN_PROGRESS','UNKNOWN']).includes(String(p.outcome)))throw new Error('INVALID_REQUEST');
 if(p.result!==null){
   const result=featureObject(p.result);featureFields(result,[],resultKeys);
   for(const [k,v] of Object.entries(result)){
     if(k==='stateRevision')workspaceRevision(v);
     else if(k==='resultingOid'||k==='candidateOid')reviewOid(v);
     else if(k==='digest'){if(typeof v!=='string'||!/^[a-f0-9]{64}$/.test(v))throw new Error('INVALID_REQUEST');}
     else if(k==='jobIds')commandIds(v);
     else workspaceUuid(v);
   }
 }
 if(p.error!==null){
   const error=featureObject(p.error),safe=foundationError(error.code as ErrorCode,{operationId:requestId,persisted:true});
   featureFields(error,Object.keys(safe));
   if(Object.entries(safe).some(([k,v])=>error[k]!==v))throw new Error('INVALID_REQUEST');
 }
 return p as unknown as ReturnType<typeof publicReviewOperation>;
}
export function reviewCapabilities(value:unknown,method:string){
 const p=featureObject(value);
 if(p.reviewVersion!==1||!Array.isArray(p.reviewMethods)||!p.reviewMethods.includes(method))throw new Error('UNSUPPORTED_VERSION');
}
