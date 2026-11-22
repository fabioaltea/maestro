import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {validateProfileParams} from '../../src/protocol/profile.js';

test('preview and skill association only accept scoped handles, revisions and grant input',()=>{
 const importHandle=randomUUID(),requestId=randomUUID(),ownerProfileId=randomUUID();
 validateProfileParams('profile.skill.preview',{scope:'PROFILE',importHandle,ownerProfileId,requestId});
 for(const invalid of [{source:'/tmp/secret'},{execute:true},{projectId:randomUUID(),scope:'GLOBAL'}])
   assert.throws(()=>validateProfileParams('profile.skill.preview',{scope:'PROFILE',importHandle,ownerProfileId,requestId,...invalid}),/INVALID_REQUEST/);
 assert.throws(()=>validateProfileParams('profile.skill.import',{requestId,previewId:randomUUID(),approved:true}),/INVALID_REQUEST/);
});

test('headless skill preview reads the selected source from stdin and can recover the preview by UUID',async t=>{
 const {spawnSync}=await import('node:child_process');
 const {createCliHarness}=await import('../fixtures/cli-harness.js');
 const {profileBoundaryFixture}=await import('../fixtures/profile-boundary.js');
 const f=await createCliHarness(t),{source}=await profileBoundaryFixture(t),requestId=randomUUID();
 assert.equal((await f.call('start')).code,0);
 const result=spawnSync(process.execPath,['dist/cli/main.js','profile','skill.preview','--input-stdin','--request-id',requestId,'--state-dir',f.archive,'--json'],
   {input:JSON.stringify({source,scope:'GLOBAL'}),encoding:'utf8'});
 assert.equal(result.status,0,result.stdout);
 const preview=JSON.parse(result.stdout).data.preview;
 assert.equal(preview.previewId,requestId);assert.equal(result.stdout.includes(source),false);
 const read=spawnSync(process.execPath,['dist/cli/main.js','profile','preview',requestId,'--state-dir',f.archive,'--json'],{encoding:'utf8'});
 assert.deepEqual(JSON.parse(read.stdout).data.preview,preview);
});
