import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {environmentCapabilities,validateEnvironmentParams} from '../../src/protocol/environment.js';

test('validate review, admission and reconcile have separate scopes and closed input',()=>{
 const requestId=randomUUID(),jobId=randomUUID(),grantId=randomUUID();
 const intent={environmentId:randomUUID(),commandSpecId:randomUUID(),inputDigest:'a'.repeat(64)};
 validateEnvironmentParams('environment.prepare',{action:'validate',intent,expectedRevisions:{stateRevision:'1'}});
 validateEnvironmentParams('environment.validate',{grantId,requestId});
 validateEnvironmentParams('environment.reconcile',{jobId,requestId,expectedStateRevision:'1'});
 for(const extra of [{pid:1},{argv:['node','--eval','exit()']},{shell:true},{workspace:'/tmp'}]){
   assert.throws(()=>validateEnvironmentParams('environment.prepare',{action:'validate',intent:{...intent,...extra},expectedRevisions:{stateRevision:'1'}}),/INVALID_REQUEST/);
 }
 assert.throws(()=>validateEnvironmentParams('environment.reconcile',{jobId,requestId,expectedStateRevision:'0'}),/INVALID_REQUEST/);
 assert.throws(()=>validateEnvironmentParams('environment.reconcile',{jobId,requestId,expectedStateRevision:'1',grantId}),/INVALID_REQUEST/);
 assert.throws(()=>environmentCapabilities({environmentVersion:1,environmentMethods:['environment.job.get']},'environment.validate'),/UNSUPPORTED_VERSION/);
});

test('CLI validates grant and reconcile revision separately, retaining the original UUID offline',async t=>{
 const {createRegistryStore}=await import('../fixtures/registry-store.js');
 const {spawnSync}=await import('node:child_process');
 const {fileURLToPath}=await import('node:url');
 const f=await createRegistryStore(t),entry=fileURLToPath(new URL('../../../dist/cli/main.js',import.meta.url));
 const requestId=randomUUID(),jobId=randomUUID(),grantId=randomUUID();
 for(const args of [['validate','--grant',grantId],['reconcile',jobId,'--expected-revision','1']]){
   const child=spawnSync(process.execPath,[entry,'environment',...args,'--request-id',requestId,'--state-dir',f.directory,'--json'],{encoding:'utf8'});
   const reply=JSON.parse(child.stdout);
   assert.equal(reply.requestId,requestId);assert.equal(reply.error.code,'DAEMON_UNAVAILABLE');
 }
 const extra=spawnSync(process.execPath,[entry,'environment','reconcile',jobId,'--expected-revision','1','--grant',grantId,
   '--request-id',requestId,'--state-dir',f.directory,'--json'],{encoding:'utf8'});
 assert.equal(extra.status,2);
});
