import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';

const protocol='../../src/protocol/review.js';
test('review wire validates opaque IDs, ref vocabulary, hashes and bounded pages',async()=>{
 const {validateReviewParams,requireReviewEnvelope}=await import(protocol),id=randomUUID();
 const good={action:'create',intent:{featureId:id,checkpointId:id,targetRef:'refs/heads/local-integration',targetOid:'a'.repeat(40)},
   expectedRevisions:{}};
 validateReviewParams('review.prepare',good);
 for(const targetRef of ['--force','refs/tags/release','refs/heads/../else','refs/heads/target.lock'])
   assert.throws(()=>validateReviewParams('review.prepare',{...good,intent:{...good.intent,targetRef}}),/INVALID_REQUEST/);
 assert.throws(()=>validateReviewParams('review.list',{projectId:id,limit:21}),/INVALID_REQUEST/);
 assert.throws(()=>validateReviewParams('review.integrate',{requestId:id,grantId:id,argv:['--force']}),/INVALID_REQUEST/);
 assert.throws(()=>requireReviewEnvelope({data:'x'.repeat(32768)}),/CONTEXT_LIMIT|INVALID_REQUEST/);
});
