import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {makeDeadline,systemClock} from '../../src/ports/clock.js';
import {createExecutionCommandProfile} from '../../src/platform/macos/execution/runtime.js';
import {createOwnedExecutionHost} from '../../src/platform/macos/execution/host.js';
import {executionBoundaryFixture} from '../fixtures/execution-boundary.js';

test('owned macOS execution host verifies identity before spawn and reports close for its own child',async t=>{
 const f=await executionBoundaryFixture(t);
 const invocation=await createExecutionCommandProfile({executable:f.probe,workspace:f.workspace,target:f.target});
 const identity={runId:randomUUID(),generation:randomUUID(),challenge:randomUUID(),leaseId:randomUUID()};
 const make=()=>createOwnedExecutionHost({invocation,identity,args:['write',f.target],cwd:f.workspace,
   deadline:makeDeadline(systemClock,5000),async consume(child){child.stdin.end();for await(const _part of child.stdout){}return{finalMessage:true};},
   async answer(){throw new Error('STALE_TARGET');}});
 const beforeGo=make();await beforeGo.ready;
 await assert.rejects(beforeGo.go({...identity,challenge:randomUUID()}),/STALE_TARGET/);
 beforeGo.stop();
 assert.equal((await beforeGo.exited).interrupted,true);
 assert.equal(await readFile(f.target,'utf8'),'authorized synthetic text');
 const live=make();await live.go(await live.ready);
 const result=await live.exited;
 assert.equal(result.code,10);
 assert.deepEqual(result.identity,identity);
 assert.equal(await readFile(f.target,'utf8'),'x');
});

test('deadline stops the owned local process and waits for observed exit',async t=>{
 const f=await executionBoundaryFixture(t);
 const invocation=await createExecutionCommandProfile({executable:'/bin/sleep',workspace:f.workspace,target:f.target});
 const identity={runId:randomUUID(),generation:randomUUID(),challenge:randomUUID(),leaseId:randomUUID()};
 const host=createOwnedExecutionHost({invocation,identity,args:['8'],cwd:f.workspace,deadline:makeDeadline(systemClock,500),
   async consume(child){for await(const _part of child.stdout){}return{finalMessage:false};},
   async answer(){throw new Error('STALE_TARGET');}});
 await host.go(await host.ready);
 const exit=await host.exited;
 assert.deepEqual(exit,{identity,verified:true,code:null,finalMessage:false,interrupted:true});
 assert.equal(await readFile(f.target,'utf8'),'authorized synthetic text');
});
