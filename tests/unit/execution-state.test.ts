import {randomUUID} from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';

test('execution requires exact generation and durable authorization before GO',async()=>{
 const {executionTransition,requireExecutionIdentity,EXECUTION_LIMITS}=await import(new URL('../../src/domain/execution/model.js',import.meta.url).href);
 const identity={runId:randomUUID(),generation:randomUUID(),leaseId:randomUUID(),challenge:randomUUID()};
 assert.equal(executionTransition('PREPARED','ready'),'HOST_READY');
 assert.equal(executionTransition('HOST_READY','authorize'),'START_AUTHORIZED');
 assert.equal(executionTransition('START_AUTHORIZED','go'),'RUNNING');
 assert.throws(()=>executionTransition('HOST_READY','go'),/INVALID_TRANSITION/);
 assert.throws(()=>requireExecutionIdentity(identity,{...identity,generation:randomUUID()}),/STALE_TARGET/);
 assert.equal(EXECUTION_LIMITS.interactions,20);assert.equal(EXECUTION_LIMITS.jobMs,1800000);
});
