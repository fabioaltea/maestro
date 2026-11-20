import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const protocol=new URL('../../src/protocol/profile.js',import.meta.url).href;

test('profile wire bounds pages and separates review, grant and trusted source intake',async()=>{
 const {profileMutation,validateProfileParams,profileCapabilities}=await import(protocol);
 const body={action:'create',intent:{scope:'GLOBAL',bundleArtifactId:randomUUID()},expectedRevisions:{}};
 validateProfileParams('profile.prepare',body);
 assert.equal(profileMutation('profile.prepare'),false);
 assert.equal(profileMutation('profile.create'),true);
 for(const extra of [{instructions:'new authority'},{allowedRoot:'/tmp'},{grantId:randomUUID()}])
   assert.throws(()=>validateProfileParams('profile.prepare',{...body,intent:{...body.intent,...extra}}),/INVALID_REQUEST/);
 assert.throws(()=>validateProfileParams('profile.list',{kind:'PROFILE',limit:21}),/INVALID_REQUEST/);
 assert.throws(()=>validateProfileParams('profile.skill.preview',{requestId:randomUUID(),importHandle:'/tmp'}));
 assert.throws(()=>profileCapabilities({profileVersion:1,profileMethods:['profile.list']},'profile.create'),/UNSUPPORTED_VERSION/);
});
