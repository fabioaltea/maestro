import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {validateReviewParams,reviewCapabilities} from '../../src/protocol/review.js';

test('review capabilities and scope cannot be borrowed from earlier workflow namespaces',()=>{
 const id=randomUUID();
 assert.throws(()=>reviewCapabilities({executionVersion:1,executionMethods:['review.create']},'review.create'),/UNSUPPORTED_VERSION/);
 assert.throws(()=>validateReviewParams('review.request-changes',{requestId:id,grantId:id,feedback:'inline text'}),/INVALID_REQUEST/);
});
test('review CLI rejects raw commands and paths before attempting a write',async()=>{
 const cli=fileURLToPath(new URL('../../src/cli/main.js',import.meta.url));
 await assert.rejects(promisify(execFile)(process.execPath,[cli,'review','create','--argv','checkout','--json']),error=>{
   assert.ok(error instanceof Error&&'stdout' in error&&typeof error.stdout==='string');
   assert.equal(JSON.parse(error.stdout).error.code,'INVALID_REQUEST');
   return true;
 });
});
