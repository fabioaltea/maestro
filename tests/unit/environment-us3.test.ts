import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {evaluateEnvironmentExit} from '../../src/domain/environments/jobs.js';

test('validation requires complete ownership and exit evidence independently of truncated output',()=>{
 const identity={jobId:randomUUID(),generation:randomUUID(),leaseId:randomUUID()};
 const proof={...identity,verified:true as const,exitCode:0,outcome:'SUCCEEDED' as const,error:null,truncated:true};
 assert.equal(evaluateEnvironmentExit(identity,null,true).phase,'RECONCILING');
 assert.equal(evaluateEnvironmentExit(identity,proof,true).phase,'SUCCEEDED');
 assert.throws(()=>evaluateEnvironmentExit(identity,{...proof,leaseId:randomUUID()},true),/STALE_TARGET/);
 assert.equal(evaluateEnvironmentExit(identity,{...proof,exitCode:null,outcome:'FAILED',error:'DEADLINE_EXCEEDED'},true).error,'DEADLINE_EXCEEDED');
});

test('manifest registers only bounded direct argv and cleanup requires unreferenced proof',async()=>{
 const {readValidationCommands,mayCleanEnvironmentJob}=await import(new URL('../../src/domain/environments/validation.js',import.meta.url).href);
 const command={id:randomUUID(),entry:'check.mjs',argv:['; $(literal) & |'],timeoutMs:2000};
 assert.deepEqual(readValidationCommands({maestro:{validation:[command]}}),[command]);
 for(const extra of [{entry:'../check.mjs'},{entry:'/tmp/check.mjs'},{entry:'link/check.mjs'},{argv:['\0']},{timeoutMs:300001},{shell:true}]){
   assert.throws(()=>readValidationCommands({maestro:{validation:[{...command,...extra}]}}),/CONFIG_UNSAFE/);
 }
 assert.throws(()=>readValidationCommands({maestro:{validation:[command,command]}}),/CONFIG_UNSAFE/);
 const owned={verified:true,quiescent:true,hasLease:false,referenced:false};
 assert.equal(mayCleanEnvironmentJob(owned),true);
 assert.equal(mayCleanEnvironmentJob({...owned,referenced:true}),false);
 assert.equal(mayCleanEnvironmentJob({...owned,hasLease:true}),false);
 assert.equal(mayCleanEnvironmentJob({...owned,verified:false}),false);
});
