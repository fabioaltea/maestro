import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';

const api='../../src/protocol/scheduler.js';
test('queue DTOs bound pages and reject callers attempting to supply a generation or a command',async()=>{
 const {validateSchedulerParams,requireSchedulerEnvelope}=await import(api);
 const id=randomUUID();
 validateSchedulerParams('scheduler.queue.list',{projectId:id,limit:20});
 for(const params of [{limit:21},{command:'/bin/sh'},{generation:id}])
   assert.throws(()=>validateSchedulerParams('scheduler.queue.list',params),/INVALID_REQUEST/);
 assert.throws(()=>validateSchedulerParams('scheduler.enqueue',{requestId:id,grantId:id,shell:'test'}),/INVALID_REQUEST/);
 assert.throws(()=>requireSchedulerEnvelope({x:'x'.repeat(32768)}),/CONTEXT_LIMIT|INVALID_REQUEST/);
});
