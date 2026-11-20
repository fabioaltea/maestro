import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile,writeFile} from 'node:fs/promises';
import {executionRuntimeFixture} from '../fixtures/execution-runtime.js';

test('durable start fences the native synthetic write, workspace lease and original request',async t=>{
 const f=await executionRuntimeFixture(t),grant=await f.prepare('start',f.startIntent),other=await f.prepare('start',f.startIntent);
 assert.equal(await readFile(f.target,'utf8'),'fixture original');
 const first=await f.mutate('start',grant);
 assert.equal(first.reply.result,'BUSY',JSON.stringify(first.reply));
 const concurrent=await f.mutate('start',other);
 assert.notEqual(concurrent.reply.result,'OK');
 await f.runtime.idle();
 assert.equal(await readFile(f.target,'utf8'),'x');
 assert.equal(f.state(first.requestId)?.state,'READY_FOR_REVIEW');
 assert.equal(f.run(first.requestId)?.phase,'FINALIZED');
 assert.equal(f.store.readWorkspaceState({kind:'active-lease',id:f.startIntent.workspaceId}).lease,null);
 const replay=await f.mutate('start',grant,first.requestId);
 assert.equal(replay.operation?.outcome,'SUCCEEDED');
 assert.deepEqual(f.counts(),{opens:1,writes:1});
});

test('a changed tree invalidates a prepared start before it opens the host',async t=>{
 const f=await executionRuntimeFixture(t),grant=await f.prepare('start',f.startIntent);
 await writeFile(f.target,'user change');
 const result=await f.mutate('start',grant);
 assert.equal((result.reply.data as {code:string}).code,'EXECUTION_APPROVAL_STALE');
 assert.deepEqual(f.counts(),{opens:0,writes:0});
 assert.equal(await readFile(f.target,'utf8'),'user change');
});
