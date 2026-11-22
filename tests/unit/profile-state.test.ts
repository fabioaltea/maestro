import {randomUUID} from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalWorkflowIntent,validateWorkflowGrant} from '../../src/domain/workflow/authorization.js';

test('profile grants are exact, expire, and replay only the consumed UUID',()=>{
 const id=randomUUID(),requestId=randomUUID();
 const intent={version:1,namespace:'PROFILE',action:'revise',storeId:randomUUID(),ownerUid:501,targetId:id,projectId:null,
   expectedRevision:'2',configRevision:null,payload:{bundleArtifactId:randomUUID()}};
 const canonicalIntent=canonicalWorkflowIntent(intent);
 const grant={grantId:randomUUID(),canonicalIntent,createdAtMs:100,expiresAtMs:200,consumedByRequestId:null};
 assert.equal(validateWorkflowGrant(grant,canonicalIntent,requestId,199),'CONSUME');
 assert.throws(()=>validateWorkflowGrant(grant,canonicalIntent,requestId,200),/APPROVAL_STALE/);
 for(const input of [{...intent,action:'disable'},{...intent,expectedRevision:'3'},{...intent,storeId:randomUUID()}])
   assert.throws(()=>validateWorkflowGrant(grant,canonicalWorkflowIntent(input),requestId,110),/APPROVAL_REQUIRED/);
 assert.equal(validateWorkflowGrant({...grant,consumedByRequestId:requestId},canonicalIntent,requestId,300),'REPLAY');
});
test('profile transitions and caps are closed',async()=>{
 const {profileTransition,PROFILE_LIMITS}=await import(new URL('../../src/domain/profiles/model.js',import.meta.url).href);
 assert.equal(profileTransition('TOOL','REVIEWED','enable'),'ENABLED');
 assert.equal(profileTransition('PROFILE','ENABLED','disable'),'DISABLED');
 assert.throws(()=>profileTransition('TOOL','DISABLED','enable'),/INVALID_TRANSITION/);
 assert.equal(PROFILE_LIMITS.profiles,100);
 assert.equal(PROFILE_LIMITS.skills,200);
 assert.equal(PROFILE_LIMITS.enabledTools,50);
 assert.equal(PROFILE_LIMITS.resolutionBytes,524288);
});
