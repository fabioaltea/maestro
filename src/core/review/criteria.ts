import {FEATURE_LIMITS,validateFeatureBundle} from '../../domain/features/bundle.js';
import type {ReviewEvidence,ReviewRecord} from '../../ports/review.js';
import type {StoragePort} from '../../ports/storage.js';
import {readSealedFeatureArtifact} from '../features/artifacts.js';

export function reviewEvidenceDigest(evidence:readonly ReviewEvidence[]){
 return createHash('sha256').update(JSON.stringify([...evidence].sort((a,b)=>a.criterionId===b.criterionId?0:a.criterionId<b.criterionId?-1:1))).digest('hex');
}

export async function readReviewCriteria(storage:StoragePort,review:Pick<ReviewRecord,'featureId'|'featureRevisionId'>){
 const {revision}=await storage.readFeatureState!({kind:'revision',id:review.featureRevisionId});
 if(!revision||revision.featureId!==review.featureId)throw new Error('ARTIFACT_CORRUPT');
 const sealed=await readSealedFeatureArtifact(storage,revision.artifactId,'BUNDLE',FEATURE_LIMITS.bundleBytes,review.featureId);
 if(sealed.artifact.sha256!==revision.bundleDigest)throw new Error('ARTIFACT_CORRUPT');
 try{return validateFeatureBundle(JSON.parse(sealed.text)).acceptanceCriteria;}
 catch{throw new Error('ARTIFACT_CORRUPT');}
}
import {createHash} from 'node:crypto';
