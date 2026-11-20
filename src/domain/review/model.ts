import {featureFields,featureObject} from '../features/bundle.js';
import type {EnvironmentJob} from '../../ports/environment.js';
import {reviewOid} from './state.js';

export const REVIEW_LIMITS=Object.freeze({files:100,diffBytes:2097152,partBytes:262144,readChunkBytes:8192});

export function partitionReviewDiff(bytes:Uint8Array,fileCount:number){
 if(!Number.isInteger(fileCount)||fileCount<0||fileCount>REVIEW_LIMITS.files||bytes.length>REVIEW_LIMITS.diffBytes)throw new Error('REVIEW_SCOPE_LIMIT');
 const parts:Uint8Array[]=[];
 for(let offset=0;offset<bytes.length;offset+=REVIEW_LIMITS.partBytes)parts.push(bytes.subarray(offset,offset+REVIEW_LIMITS.partBytes));
 return parts;
}

interface CheckpointScope {readonly digest:string;readonly tree:string;readonly revision:string}

export function requireCleanReviewCheckpoint(value:unknown,expected:CheckpointScope,observed:CheckpointScope):string{
 let checkpoint:Record<string,unknown>,oid:string;
 try{
   checkpoint=featureObject(value);
   featureFields(checkpoint,['version','baseOid','trackedDiff','untracked']);
   if(checkpoint.version!==1||typeof checkpoint.trackedDiff!=='string'||!Array.isArray(checkpoint.untracked))throw new Error();
   oid=reviewOid(checkpoint.baseOid);
 }catch{throw new Error('ARTIFACT_CORRUPT');}
 if(checkpoint.trackedDiff!==''||(checkpoint.untracked as unknown[]).length)throw new Error('SOURCE_NOT_QUIESCENT');
 if(expected.digest!==observed.digest||expected.tree!==observed.tree||expected.revision!==observed.revision)throw new Error('REVIEW_STALE');
 return oid;
}

export type ReviewCheckStatus='PASS'|'FAIL'|'NOT_RUN'|'BLOCKED';

export function reviewCheckStatus(scope:{readonly jobId:string;readonly planId:string;readonly commandSpecId:string;
 readonly inputDigest:string;readonly treeOid:string},job:EnvironmentJob|null,observedTreeOid:string|null):ReviewCheckStatus{
 if(observedTreeOid!==scope.treeOid)return 'BLOCKED';
 if(!job)return 'NOT_RUN';
 if(job.jobId!==scope.jobId||job.kind!=='VALIDATE'||job.planId!==scope.planId||job.commandSpecId!==scope.commandSpecId||
    job.inputDigest!==scope.inputDigest||!job.completedAt||!job.exitProof?.verified)return 'BLOCKED';
 if(job.phase==='FAILED')return 'FAIL';
 if(job.phase!=='SUCCEEDED'||job.exitProof.code!==0||job.exitProof.reason!==null||job.safeError!==null||job.truncated||job.outputWatermark==='0')return 'BLOCKED';
 return 'PASS';
}

export function requireCandidateEvidence(criterionIds:readonly string[],proofs:readonly {
 criterionId:string;treeOid:string;jobId:string|null;status:ReviewCheckStatus;
}[],treeOid:string){
 for(const id of criterionIds){
   const observed=proofs.filter(proof=>proof.criterionId===id&&proof.treeOid===treeOid);
   if(observed.some(proof=>proof.status==='FAIL'))throw new Error('CHECKS_FAILED');
   if(!observed.length||observed.some(proof=>proof.status!=='PASS'||proof.jobId===null))throw new Error('CHECKS_NOT_RUN');
 }
}
