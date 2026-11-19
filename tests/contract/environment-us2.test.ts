import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
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
