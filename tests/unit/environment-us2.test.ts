import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

import {requireEnvironmentInstall,evaluateEnvironmentExit} from '../../src/domain/environments/jobs.js';
const digest='a'.repeat(64);
test('install cannot start from a manual, stale or unqualified plan',()=>{
 const scope={state:'PLANNED' as const,disposition:'PLANNED' as const,pinDigest:digest,observedPinDigest:digest,inputDigest:digest,observedInputDigest:digest};
 requireEnvironmentInstall(scope);
 assert.throws(()=>requireEnvironmentInstall({...scope,state:'MANUAL_VERIFIED'}),/ENVIRONMENT_STALE/);
 assert.throws(()=>requireEnvironmentInstall({...scope,state:'RECONCILING'}),/JOB_RECONCILING/);
 assert.throws(()=>requireEnvironmentInstall({...scope,observedInputDigest:'b'.repeat(64)}),/ENVIRONMENT_STALE/);
 assert.throws(()=>requireEnvironmentInstall({...scope,observedPinDigest:null}),/MANAGER_MISMATCH/);
});
test('exit must bind generation and lease and ready also requires unchanged inputs',()=>{
 const identity={jobId:randomUUID(),generation:randomUUID(),leaseId:randomUUID()};
 const proof={...identity,verified:true as const,exitCode:0,outcome:'SUCCEEDED' as const,error:null};
 assert.equal(evaluateEnvironmentExit(identity,proof,true).phase,'SUCCEEDED');
 assert.equal(evaluateEnvironmentExit(identity,proof,false).error,'ENVIRONMENT_STALE');
 assert.equal(evaluateEnvironmentExit(identity,null,true).phase,'RECONCILING');
 assert.throws(()=>evaluateEnvironmentExit(identity,{...proof,generation:randomUUID()},true),/STALE_TARGET/);
 assert.equal(evaluateEnvironmentExit(identity,{...proof,outcome:'FAILED',exitCode:1,error:'LOCKFILE_CHANGED'},true).phase,'FAILED');
});
