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
