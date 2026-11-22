import {discoverySourceExclusion} from '../../domain/discovery/context-policy.js';
import type {AuthenticatedPeer} from '../../ports/platform.js';
import type {ReviewContextInvalidation,ReviewRecord} from '../../ports/review.js';
import type {ReviewServicesOptions} from './snapshot.js';

export async function reviewContextImpact(options:Pick<ReviewServicesOptions,'storage'|'currentEligibility'>,
 review:ReviewRecord,paths:readonly string[],peer:AuthenticatedPeer):Promise<{
   impact:'TOUCHED'|'UNCHANGED'|'UNKNOWN';invalidate:ReviewContextInvalidation|null;
 }>{
 const {storage}=options,unknown={impact:'UNKNOWN' as const,invalidate:null};
 if(!storage.readDiscoveryMetadata)return unknown;
 const {revision}=await storage.readFeatureState!({kind:'revision',id:review.featureRevisionId});
 if(!revision||revision.featureId!==review.featureId)return unknown;
 const approved=await storage.readDiscoveryMetadata({kind:'approval',id:revision.discoveryRevisionId});
 const approval=approved.ok?approved.value.data:null;
 if(!approval||approval.approvalId!==revision.discoveryApprovalId||approval.projectId!==review.projectId)return unknown;
 const current=await storage.readDiscoveryMetadata({kind:'discovery',id:approval.discoveryId});
 const discovery=current.ok?current.value.data:null;
 if(!discovery||discovery.latestDocumentRevisionId!==approval.revisionId||discovery.configRevision!==approval.configRevision)return unknown;
 if(discovery.state==='STALE')return{impact:'TOUCHED',invalidate:null};
 if(discovery.state!=='APPROVED')return unknown;
 const sealed=await storage.readDiscoveryMetadata({kind:'snapshot',id:discovery.snapshotId});
 const snapshot=sealed.ok?sealed.value.data:null;
 if(!snapshot||snapshot.state!=='SEALED'||snapshot.contextDigest!==approval.contextDigest)return unknown;
 const canonicalPaths=paths.map(path=>path.normalize('NFC'));
 if(canonicalPaths.some(path=>!discoverySourceExclusion(path)&&snapshot.selectors.some(selector=>selector==='.'||selector===path||path.startsWith(`${selector}/`)))){
   return{impact:'TOUCHED',invalidate:{discoveryId:discovery.discoveryId,discoveryRevision:discovery.stateRevision,
     snapshotId:snapshot.snapshotId,approvalRevisionId:approval.revisionId}};
 }
 const eligible=await options.currentEligibility(peer,review.projectId).catch(()=>null);
 if(eligible?.eligible&&eligible.approvalId===approval.approvalId)return{impact:'UNCHANGED',invalidate:null};
 return eligible?.reason==='APPROVAL_STALE'&&eligible.approvalId===approval.approvalId?{impact:'TOUCHED',invalidate:null}:unknown;
}
