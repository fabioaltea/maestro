import {executionInteractionText} from '../../domain/execution/interaction.js';
import {EXECUTION_LIMITS} from '../../domain/execution/model.js';
import type {StoragePort} from '../../ports/storage.js';
import {readSealedFeatureArtifact} from '../features/artifacts.js';

export async function loadReviewFeedback(storage:StoragePort,decisionId:string,selection:{
 readonly featureId:string;readonly featureRevisionId:string;readonly workspaceId:string;
}){
 const {feedback}=await storage.readReviewState?.({kind:'feedback',id:decisionId})??{};
 if(!feedback||feedback.featureId!==selection.featureId||feedback.featureRevisionId!==selection.featureRevisionId||
    feedback.workspaceId!==selection.workspaceId)throw new Error('EXECUTION_APPROVAL_STALE');
 const artifact=await readSealedFeatureArtifact(storage,feedback.artifactId,'INPUT',EXECUTION_LIMITS.interactionBytes,selection.featureId);
 return{...feedback,sha256:artifact.artifact.sha256,text:executionInteractionText(artifact.text)};
}
