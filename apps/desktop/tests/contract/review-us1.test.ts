import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {validateRequest} from '../../src/shared/validation.ts';
import {buildCliArgs} from '../../src/main/core-cli.ts';
import {validateReviewData} from '../../src/shared/review-contract.ts';

test('Desktop review bridge permits scoped diff reads and rejects filesystem selectors',()=>{
 const id=randomUUID(),base={bridgeVersion:1,callId:randomUUID(),selectionEpoch:1};
 validateRequest('getReviewDiffPart',{...base,artifactId:id});
 assert.throws(()=>validateRequest('getReviewDiffPart',{...base,artifactId:id,path:'/private/worktree'}));
 assert.deepEqual(buildCliArgs({namespace:'review',action:'artifact',archive:'/tmp/archive',params:{artifactId:id}}),
   ['review','artifact','--state-dir=/tmp/archive','--json','--',id]);
 const diff=Buffer.from('+<script>fixture diff</script>','utf8');
 const p={artifactId:id,sha256:'c'.repeat(64),totalBytes:diff.length,offset:0,base64:diff.toString('base64'),nextCursor:null,freshness:'LAST_KNOWN'};
 assert.deepEqual(validateReviewData('artifact',p,{artifactId:id}),p);
 assert.throws(()=>validateReviewData('artifact',{...p,artifactId:randomUUID()},{artifactId:id}));
 assert.throws(()=>validateReviewData('artifact',{...p,base64:'data:text/html,<script>'},{artifactId:id}));
});

test('activity projection preserves review correlation and removes diff output',async()=>{
 const {projectSafe}=await import('../../src/main/core-cli.ts'),{decodeUiEvent}=await import('../../src/shared/activity-contract.ts');
 const storeId=randomUUID(),reviewId=randomUUID(),operationId=randomUUID();
 const raw={protocolVersion:1,storeId,eventId:randomUUID(),seq:'1',occurredAt:new Date().toISOString(),instanceId:null,
   operationId,type:'review.changed',payload:{scope:'review',reviewId,stateRevision:'1',state:'DRAFT',diff:'private'}};
 const event=decodeUiEvent(projectSafe(raw),storeId);
 assert.equal(event.operationId,operationId);
 assert.deepEqual(event.payload,{scope:'review',reviewId,stateRevision:'1',state:'DRAFT'});
});
