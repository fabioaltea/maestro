import {FEATURE_LIMITS,validateFeatureBundle} from '../../domain/features/bundle.js';
import type {ReviewRecord} from '../../ports/review.js';
import type {StoragePort} from '../../ports/storage.js';
import {readSealedFeatureArtifact} from '../features/artifacts.js';

export async function readReviewCriteria(storage:StoragePort,review:Pick<ReviewRecord,'featureId'|'featureRevisionId'>){
 const {revision}=await storage.readFeatureState!({kind:'revision',id:review.featureRevisionId});
 if(!revision||revision.featureId!==review.featureId)throw new Error('ARTIFACT_CORRUPT');
 const sealed=await readSealedFeatureArtifact(storage,revision.artifactId,'BUNDLE',FEATURE_LIMITS.bundleBytes,review.featureId);
 if(sealed.artifact.sha256!==revision.bundleDigest)throw new Error('ARTIFACT_CORRUPT');
 try{return validateFeatureBundle(JSON.parse(sealed.text)).acceptanceCriteria;}
 catch{throw new Error('ARTIFACT_CORRUPT');}
}
