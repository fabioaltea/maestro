import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createRegistryStore} from '../fixtures/registry-store.js';
import {environmentMutation,validateEnvironmentParams,environmentCapabilities} from '../../src/protocol/environment.js';

test('install and cancel distinguish review, grant scope and bounded job output',()=>{
 const jobId=randomUUID(),grantId=randomUUID(),requestId=randomUUID();
 const prepare={action:'prepare',intent:{planId:randomUUID(),planDigest:'a'.repeat(64)},expectedRevisions:{stateRevision:'1'}};
 validateEnvironmentParams('environment.prepare',prepare);
 assert.equal(environmentMutation('environment.prepare',prepare),false);
 validateEnvironmentParams('environment.prepare',{grantId,requestId});
 assert.equal(environmentMutation('environment.prepare',{grantId,requestId}),true);
 validateEnvironmentParams('environment.prepare',{action:'cancel',intent:{jobId},expectedRevisions:{stateRevision:'1'}});
 for(const p of [{grantId,requestId,force:true},{grantId,requestId,pid:process.pid},{grantId,requestId,registry:'https://example.invalid'}]){
   assert.throws(()=>validateEnvironmentParams('environment.prepare',p),/INVALID_REQUEST/);
 }
 assert.throws(()=>validateEnvironmentParams('environment.cancel',{jobId,requestId}),/INVALID_REQUEST/);
 assert.throws(()=>validateEnvironmentParams('environment.output.list',{jobId,limit:0}),/INVALID_REQUEST/);
 assert.throws(()=>environmentCapabilities({environmentVersion:1,environmentMethods:['environment.list']},'environment.prepare'),/UNSUPPORTED_VERSION/);
});

test('CLI install and cancel retain original UUIDs and enforce closed grant input',async t=>{
 const f=await createRegistryStore(t),entry=fileURLToPath(new URL('../../../dist/cli/main.js',import.meta.url));
 const requestId=randomUUID(),grantId=randomUUID();
 for(const method of ['prepare','cancel']){
   const granted=spawnSync(process.execPath,[entry,'environment',method,'--grant',grantId,'--request-id',requestId,'--state-dir',f.directory,'--json'],{encoding:'utf8'});
   const result=JSON.parse(granted.stdout);
   assert.equal(result.requestId,requestId);assert.equal(result.error.code,'DAEMON_UNAVAILABLE');
 }
 const extra=spawnSync(process.execPath,[entry,'environment','prepare','--grant',grantId,'--request-id',requestId,'--input-stdin','--json'],{encoding:'utf8'});
 assert.equal(extra.status,2);
});
