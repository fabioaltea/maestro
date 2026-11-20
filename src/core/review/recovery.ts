import {requireRefAttribution,type RefAttribution} from '../../domain/review/integration.js';
import type {Deadline} from '../../ports/clock.js';
import type {GitIntegrationPort,GitIntegrationScope,IntegrationGuard} from '../../ports/git-integration.js';
import type {StoragePort} from '../../ports/storage.js';

export async function settlePublishedIntegration(options:{storage:StoragePort;instanceId:string;git:GitIntegrationPort},
 scope:GitIntegrationScope,guard:IntegrationGuard,expected:RefAttribution,deadline:Deadline,recovering?:true){
 const {storage,instanceId,git}=options;
 const command={requestId:expected.requestId,instanceId,...(recovering?{recovering}:{})};
 const observed=await git.observePublication(scope,guard,expected,deadline);
 if(observed.targetOid!==expected.candidate)throw new Error('INTEGRATION_UNKNOWN');
 const proof=requireRefAttribution(expected,observed.proof);
 await storage.commitReviewState!({kind:'integration-ref',...command,proof});
 await git.syncGuard(scope,guard,deadline,expected.candidate);
 return storage.commitReviewState!({kind:'integration-finish',...command});
}
