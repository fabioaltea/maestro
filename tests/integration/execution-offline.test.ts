import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {inspectExecution} from '../../src/core/inspect-main.js';
import {workspaceAuthoringFixture} from '../fixtures/workspace-authoring.js';

test('offline execution reads pinned archive state without creating files or applying changes',async t=>{
 const f=await workspaceAuthoringFixture(t),directory=f.paths.directory;
 f.store.close();
 const files=(await readdir(directory)).sort(),before=await readFile(f.paths.stateFile);
 const response=await inspectExecution(directory,'execution.provider.get',{providerId:'codex'});
 assert.equal(response.result,'OK',JSON.stringify(response));assert.equal(response.freshness,'LAST_KNOWN');
 assert.deepEqual(response.data.provider,{providerId:'codex',status:'UNCONFIGURED',configRevision:null,nativeResume:false});
 const denied=await inspectExecution(directory,'execution.start',{requestId:randomUUID(),grantId:randomUUID()});
 assert.equal(denied.error?.code,'DAEMON_UNAVAILABLE');
 assert.deepEqual((await readdir(directory)).sort(),files);
 assert.deepEqual(await readFile(f.paths.stateFile),before);
});
