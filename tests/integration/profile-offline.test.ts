import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {createCliHarness} from '../fixtures/cli-harness.js';

test('offline profile catalogue uses the historical reader without changing archive files',async t=>{
 const f=await createCliHarness(t);
 assert.equal((await f.call('start')).code,0);
 assert.equal((await f.call('stop')).code,0);
 const file=f.archive+'/state.sqlite',before=await readFile(file),names=await readdir(f.archive);
 const {inspectProfile}=await import(new URL('../../src/core/inspect-main.js',import.meta.url).href);
 const result=await inspectProfile(f.archive,'profile.list',{kind:'PROFILE'});
 assert.equal(result.result,'OK',JSON.stringify(result));assert.equal(result.freshness,'LAST_KNOWN');
 assert.ok(Array.isArray(result.data.items));
 assert.deepEqual(await readFile(file),before);
 assert.deepEqual((await readdir(f.archive)).sort(),names.sort());
});
