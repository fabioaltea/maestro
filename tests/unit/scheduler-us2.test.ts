import assert from 'node:assert/strict';
import test from 'node:test';
const domain='../../src/domain/scheduler/wait.js';
test('sticky retry needs an observed live quota, keeps clock rollback waiting and caps attempts',async()=>{
 const {decideStickyRetry}=await import(domain);
 const now=1800000000000;
 const wait={reason:'PROVIDER_QUOTA',observedAt:now,resetAt:now+10000,observedUntil:now+300000,providerId:'codex'};
 const policy={providerId:'codex',authorized:true,expiresAt:now+600000,attempts:0};
 assert.equal(decideStickyRetry({...wait,resetAt:null},policy,now).code,'QUOTA_RESET_UNKNOWN');
 assert.equal(decideStickyRetry(wait,policy,now-30000).notBefore,now+60000);
 assert.equal(decideStickyRetry(wait,policy,now+60000).state,'REVALIDATE');
 assert.equal(decideStickyRetry(wait,{...policy,authorized:false},now+60000).code,'POLICY_REVOKED');
 assert.equal(decideStickyRetry(wait,{...policy,attempts:3},now).code,'RETRY_EXHAUSTED');
 assert.equal(decideStickyRetry({...wait,reason:'UNKNOWN_OUTCOME'},policy,now).code,'RESERVATION_UNKNOWN');
});
