import assert from 'node:assert/strict';
import test from 'node:test';
const domain='../../src/domain/scheduler/provider-policy.js';
test('fallback and comparable cost decisions are fenced by exit, provider revision and recipient',async()=>{
 const {evaluateProviderPolicy}=await import(domain),now=1800000000000;
 const provider={providerId:'claude',revision:'1',qualified:true,capabilities:['WRITE'],recipient:'claude-tenant'};
 const policy={mode:'FALLBACK',authorized:true,expiresAt:now+60000,attempts:1,
   refs:[{providerId:'claude',revision:'1',recipient:'claude-tenant'}],capabilities:['WRITE']};
 const proof={checkpointCurrent:true,processExited:true,remoteOutstanding:false};
 assert.equal(evaluateProviderPolicy(policy,proof,[provider],now).providerId,'claude');
 assert.equal(evaluateProviderPolicy(policy,{...proof,remoteOutstanding:true},[provider],now).code,'RESERVATION_UNKNOWN');
 assert.equal(evaluateProviderPolicy(policy,proof,[{...provider,recipient:'other'}],now).code,'NO_COMPATIBLE_PROVIDER');
 assert.equal(evaluateProviderPolicy({...policy,mode:'COST_AWARE'},proof,[provider],now).code,'COST_UNKNOWN');
});
