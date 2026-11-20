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
