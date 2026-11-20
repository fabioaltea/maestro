import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {reviewCapabilities,validateReviewParams} from '../../src/protocol/review.js';

test('candidate and integrate validate the qualified method and never accept force or a ref path on confirm',()=>{
 const id=randomUUID();
 validateReviewParams('review.integrate',{requestId:id,grantId:id});
 for(const field of ['force','path','expectedTargetOid'])
   assert.throws(()=>validateReviewParams('review.integrate',{requestId:id,grantId:id,[field]:true}),/INVALID_REQUEST/);
 assert.throws(()=>reviewCapabilities({reviewVersion:1,reviewMethods:['review.create','review.get']},'review.integrate'),/UNSUPPORTED_VERSION/);
});
