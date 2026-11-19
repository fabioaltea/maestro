import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
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
