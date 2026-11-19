import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

const jobsModule='../../src/domain/environments/jobs.js';
const digest='a'.repeat(64);
test('install cannot start from a manual, stale or unqualified plan',async()=>{
 const {requireEnvironmentInstall}=await import(jobsModule);
 const scope={state:'PLANNED',disposition:'PLANNED',pinDigest:digest,observedPinDigest:digest,inputDigest:digest,observedInputDigest:digest};
 requireEnvironmentInstall(scope);
 assert.throws(()=>requireEnvironmentInstall({...scope,state:'MANUAL_VERIFIED'}),/ENVIRONMENT_STALE/);
 assert.throws(()=>requireEnvironmentInstall({...scope,state:'RECONCILING'}),/JOB_RECONCILING/);
 assert.throws(()=>requireEnvironmentInstall({...scope,observedInputDigest:'b'.repeat(64)}),/ENVIRONMENT_STALE/);
 assert.throws(()=>requireEnvironmentInstall({...scope,observedPinDigest:null}),/MANAGER_MISMATCH/);
});
test('exit must bind generation and lease and ready also requires unchanged inputs',async()=>{
 const {evaluateEnvironmentExit}=await import(jobsModule);
 const identity={jobId:randomUUID(),generation:randomUUID(),leaseId:randomUUID()};
 const proof={...identity,verified:true,exitCode:0,outcome:'SUCCEEDED',error:null};
 assert.equal(evaluateEnvironmentExit(identity,proof,true).phase,'SUCCEEDED');
 assert.equal(evaluateEnvironmentExit(identity,proof,false).error,'ENVIRONMENT_STALE');
 assert.equal(evaluateEnvironmentExit(identity,null,true).phase,'RECONCILING');
 assert.throws(()=>evaluateEnvironmentExit(identity,{...proof,generation:randomUUID()},true),/STALE_TARGET/);
 assert.equal(evaluateEnvironmentExit(identity,{...proof,outcome:'FAILED',exitCode:1,error:'LOCKFILE_CHANGED'},true).phase,'FAILED');
});
