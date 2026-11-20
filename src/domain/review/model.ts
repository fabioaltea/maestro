export const REVIEW_LIMITS=Object.freeze({files:100,diffBytes:2097152,partBytes:262144,readChunkBytes:8192});

export function partitionReviewDiff(bytes:Uint8Array,fileCount:number){
 if(!Number.isInteger(fileCount)||fileCount<0||fileCount>REVIEW_LIMITS.files||bytes.length>REVIEW_LIMITS.diffBytes)throw new Error('REVIEW_SCOPE_LIMIT');
 const parts:Uint8Array[]=[];
 for(let offset=0;offset<bytes.length;offset+=REVIEW_LIMITS.partBytes)parts.push(bytes.subarray(offset,offset+REVIEW_LIMITS.partBytes));
 return parts;
}
export function requireCandidateEvidence(criterionIds:readonly string[],proofs:readonly {
 criterionId:string;treeOid:string;jobId:string|null;status:'PASS'|'FAIL'|'NOT_RUN'|'BLOCKED';
}[],treeOid:string){
 for(const id of criterionIds){
   const observed=proofs.filter(proof=>proof.criterionId===id&&proof.treeOid===treeOid);
   if(observed.some(proof=>proof.status==='FAIL'))throw new Error('CHECKS_FAILED');
   if(!observed.some(proof=>proof.status==='PASS'&&proof.jobId!==null))throw new Error('CHECKS_NOT_RUN');
 }
}
