import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import test from 'node:test';
import {executionCompletion,executionTransition} from '../../src/domain/execution/model.js';

test('owned exit requires the original challenge even with the same run, generation and lease',()=>{
 const identity={runId:randomUUID(),generation:randomUUID(),leaseId:randomUUID(),challenge:randomUUID()};
 assert.throws(()=>executionTransition('PREPARED','go'),/INVALID_TRANSITION/);
 assert.throws(()=>executionTransition('HOST_READY','go'),/INVALID_TRANSITION/);
 assert.throws(()=>executionCompletion(identity,{identity:{...identity,challenge:randomUUID()},verified:true,finalMessage:true,code:0,interrupted:false},null),/STALE_TARGET/);
 assert.deepEqual(executionCompletion(identity,null,null),{state:'RECONCILING',outcome:'UNKNOWN'});
 assert.deepEqual(executionCompletion(identity,{identity,verified:true,finalMessage:false,code:0,interrupted:false},null),{state:'FAILED',outcome:'FAILED'});
});
