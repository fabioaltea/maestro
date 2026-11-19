import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createWorkspaceDispatch} from '../../src/core/workspaces/dispatch.js';
import {createRegistryStore} from '../fixtures/registry-store.js';
import type {StoragePort} from '../../src/ports/storage.js';
import type {AuthenticatedPeer} from '../../src/ports/platform.js';

test('workspace create requires composed capability, authorized role and shut DTOs',async t=>{
 const f=await createRegistryStore(t),storage=f.store as unknown as StoragePort;
 const peer:AuthenticatedPeer={role:'client',identity:'fixture',credentialId:'fixture'};
 const request={protocolVersion:1 as const,correlationId:randomUUID(),method:'workspace.create',params:{requestId:randomUUID(),grantId:randomUUID()}};
 const send=createWorkspaceDispatch({storage}),snapshot=f.store.readSnapshot()!;
 const result=await send(request,peer,snapshot);
 assert.equal((result.data as {code:string}).code,'UNSUPPORTED_VERSION');
 const overScoped=await send({...request,params:{...request.params,shell:'git'}},peer,snapshot);
 assert.equal((overScoped.data as {code:string}).code,'INVALID_REQUEST');
 assert.equal(( (await send(request,{...peer,role:'controller'},snapshot)).data as {code:string}).code,'UNAUTHORIZED');
 const prior=await send(request,peer,{...snapshot,store:{...snapshot.store,schemaVersion:5}});
 assert.equal((prior.data as {code:string}).code,'WORKSPACE_NOT_INITIALIZED');
});
