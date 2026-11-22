import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRegistryStore} from '../fixtures/registry-store.js';
import {createFeatureRuntime} from '../../src/core/features/runtime.js';
import {createPlatformPaths} from '../../src/platform/macos/paths.js';
import type {StoragePort} from '../../src/ports/storage.js';
import type {AuthenticatedPeer} from '../../src/ports/platform.js';
const peer:AuthenticatedPeer={identity:'fixture',credentialId:'fixture',role:'client'};
test('US1 public mutations require a core grant even through an alternative authenticated client',async t=>{
 const f=await createRegistryStore(t),paths=(await createPlatformPaths().resolveArchive(f.directory,'read'))!,runtime=createFeatureRuntime(f.store as unknown as StoragePort,paths,f.instanceId);await runtime.recover();
 const requestId=randomUUID(),result=await runtime.dispatch({protocolVersion:1,correlationId:randomUUID(),method:'feature.create',params:{requestId,grantId:randomUUID()}},peer,f.store.readSnapshot()!);
 assert.equal((result.data as {code:string}).code,'APPROVAL_REQUIRED');assert.equal(f.store.readFeatureState({kind:'operation',id:requestId}).operation,null);
});
test('US1 controller, client-supplied approval and an older schema cannot enter authoring',async t=>{
 const f=await createRegistryStore(t),paths=(await createPlatformPaths().resolveArchive(f.directory,'read'))!,runtime=createFeatureRuntime(f.store as unknown as StoragePort,paths,f.instanceId);await runtime.recover();const snapshot=f.store.readSnapshot()!;
 const request={protocolVersion:1 as const,correlationId:randomUUID(),method:'feature.create',params:{requestId:randomUUID(),grantId:randomUUID()}};
 const controller=await runtime.dispatch(request,{...peer,role:'controller'},snapshot);assert.equal((controller.data as {code:string}).code,'UNAUTHORIZED');
 const forged=await runtime.dispatch({...request,params:{...request.params,approved:true}},peer,snapshot);assert.equal((forged.data as {code:string}).code,'INVALID_REQUEST');
 const historical=await runtime.dispatch(request,peer,{...snapshot,store:{...snapshot.store,schemaVersion:4}});assert.equal((historical.data as {code:string}).code,'FEATURE_NOT_INITIALIZED');
});
