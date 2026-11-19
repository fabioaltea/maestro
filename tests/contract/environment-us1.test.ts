import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createRegistryStore} from '../fixtures/registry-store.js';
import {createEnvironmentDispatch} from '../../src/core/environments/dispatch.js';
import {validateEnvironmentParams,environmentCapabilities} from '../../src/protocol/environment.js';
import type {StoragePort} from '../../src/ports/storage.js';

test('environment planning and attestation reject unsupported capability and out-of-scope inputs',async t=>{
 const f=await createRegistryStore(t),peer={role:'client' as const,identity:'fixture',credentialId:'fixture'};
 const params={requestId:randomUUID(),workspaceId:randomUUID(),expectedStateRevision:'1'};
 const request={protocolVersion:1 as const,correlationId:randomUUID(),method:'environment.plan',params};
 const send=createEnvironmentDispatch({storage:f.store as unknown as StoragePort}),snapshot=f.store.readSnapshot()!;
 const absent=await send(request,peer,snapshot);
 assert.equal((absent.data as {code:string}).code,'UNSUPPORTED_VERSION');
 assert.throws(()=>environmentCapabilities({environmentVersion:1,environmentMethods:['environment.get']},request.method),/UNSUPPORTED_VERSION/);
 assert.equal((await send(request,{...peer,role:'auxiliary'},snapshot)).result,'ERROR');
 validateEnvironmentParams('environment.prepare',{action:'attest',intent:{workspaceId:params.workspaceId,inputDigest:'a'.repeat(64),limitations:['Installazione manuale']},
   expectedRevisions:{stateRevision:'1'}});
 for(const limitations of [[],['x'.repeat(257)],['example\0unsafe']]){
   assert.throws(()=>validateEnvironmentParams('environment.prepare',{action:'attest',intent:{workspaceId:params.workspaceId,inputDigest:'a'.repeat(64),limitations},
     expectedRevisions:{stateRevision:'1'}}),/INVALID_REQUEST|CONTEXT_LIMIT/);
 }
});

test('environment CLI plans with exactly one UUID and keeps attestation data off argv',async t=>{
 const f=await createRegistryStore(t),entry=fileURLToPath(new URL('../../../dist/cli/main.js',import.meta.url));
 const flags=['--state-dir',f.directory,'--json'],workspaceId=randomUUID(),requestId=randomUUID();
 const run=(args:string[],input?:string)=>spawnSync(process.execPath,[entry,'environment',...args,...flags],{encoding:'utf8',input});
 const plan=JSON.parse(run(['plan',workspaceId,'--expected-revision','1','--request-id',requestId]).stdout);
 assert.equal(plan.requestId,requestId);assert.equal(plan.error.code,'DAEMON_UNAVAILABLE');
 const limitations='testo di attestazione fixture';
 const prepare=run(['prepare','--input-stdin'],JSON.stringify({action:'attest',intent:{workspaceId,inputDigest:'a'.repeat(64),limitations:[limitations]},
   expectedRevisions:{stateRevision:'1'}}));
 assert.equal(JSON.parse(prepare.stdout).error.code,'DAEMON_UNAVAILABLE');
 assert.ok(!prepare.stdout.includes(limitations));
 assert.equal(run(['prepare',limitations]).status,2);
});
