import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {workspaceAuthoringFixture} from '../fixtures/workspace-authoring.js';

const reader='../../src/core/inspect-main.js';
test('offline review is immutable and refuses mutations',async t=>{
 const {inspectReview}=await import(reader),f=await workspaceAuthoringFixture(t);
 f.store.close();
 const directory=f.paths.directory,before=await readFile(f.paths.stateFile),files=(await readdir(directory)).sort();
 const reply=await inspectReview(directory,'review.list',{projectId:f.projectId});
 assert.equal(reply.result,'OK',JSON.stringify(reply));assert.equal(reply.freshness,'LAST_KNOWN');assert.deepEqual(reply.data.items,[]);
 const refused=await inspectReview(directory,'review.create',{requestId:randomUUID(),grantId:randomUUID()});
 assert.equal(refused.error?.code,'DAEMON_UNAVAILABLE');
 assert.deepEqual(await readFile(f.paths.stateFile),before);assert.deepEqual((await readdir(directory)).sort(),files);
});
