import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {validateExecutionParams} from '../../src/protocol/execution.js';

test('provider configuration accepts only opaque selectors and safe model identifiers',()=>{
 const id=randomUUID();
 const valid={action:'provider.configure',intent:{providerId:'codex',binaryHandle:id,modelId:'fixture',authProfileRef:id},
   expectedRevisions:{configRevision:null}};
 validateExecutionParams('execution.prepare',valid);
 for(const [key,value] of [['binaryHandle','/tmp/bin'],['authProfileRef','literal key'],['modelId','https://invalid']] as const)
   assert.throws(()=>validateExecutionParams('execution.prepare',{...valid,intent:{...valid.intent,[key]:value}}),/INVALID_REQUEST/);
});

test('CLI refuses unknown command- or credential-bearing flags before archive access',async()=>{
 const cli=fileURLToPath(new URL('../../src/cli/main.js',import.meta.url));
 for(const args of [['--command','rm'],['--api-key','token']]){
   try{await promisify(execFile)(process.execPath,[cli,'execution','start','--json',...args]);assert.fail('invalid invocation accepted');}
   catch(error){
     assert.ok(error instanceof Error&&'stdout' in error&&typeof error.stdout==='string');
     assert.equal(JSON.parse(error.stdout).error.code,'INVALID_REQUEST');
     assert.ok(!error.stdout.includes('token'));
   }
 }
});
