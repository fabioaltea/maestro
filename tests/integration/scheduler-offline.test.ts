import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import test from 'node:test';
import {schedulerStoreFixture} from '../fixtures/scheduler-store.js';

const reader='../../src/core/inspect-main.js';
test('offline scheduling observes the retained queue without modifying its archive',async t=>{
 const {inspectScheduler}=await import(reader),f=await schedulerStoreFixture(t),a=f.enqueue(f.intent());
 f.store.commitSchedulerState({kind:'enqueue',admission:a});f.store.close();
 const directory=f.paths.directory,before=await readFile(f.paths.stateFile),files=(await readdir(directory)).sort();
 const data=await inspectScheduler(directory,'scheduler.queue.list',{projectId:f.projectId});
 assert.equal(data.result,'OK',JSON.stringify(data));assert.equal(data.freshness,'LAST_KNOWN');
 assert.equal((data.data.jobs as {jobId:string}[])[0]?.jobId,a.requestId);
 assert.deepEqual((await readdir(directory)).sort(),files);
 assert.deepEqual(await readFile(f.paths.stateFile),before);
});
