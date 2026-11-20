import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {reviewCapabilities,validateReviewParams} from '../../src/protocol/review.js';

test('completion and cleanup observations are separate and never imply authorization',()=>{
 const id=randomUUID(),complete={requestId:id,integrationId:id,expectedStateRevision:'4'};
 validateReviewParams('review.complete',complete);
 validateReviewParams('review.receipt.get',{integrationId:id});
 validateReviewParams('review.cleanup.preview',{integrationId:id,workspaceId:id});
 assert.throws(()=>validateReviewParams('review.complete',{...complete,cleanup:true}),/INVALID_REQUEST/);
 assert.throws(()=>validateReviewParams('review.cleanup.preview',{integrationId:id,workspaceId:id,force:true}),/INVALID_REQUEST/);
 assert.throws(()=>reviewCapabilities({reviewVersion:1,reviewMethods:['review.get']},'review.complete'),/UNSUPPORTED_VERSION/);
});
