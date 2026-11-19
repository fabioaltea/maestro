import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createWorkspaceDispatch} from '../../src/core/workspaces/dispatch.js';
import {workspaceCapabilities,validateWorkspaceParams} from '../../src/protocol/workspace.js';
import {createRegistryStore} from '../fixtures/registry-store.js';
import type {StoragePort} from '../../src/ports/storage.js';

test('workspace refresh requires composed live capability and accepts only the workspace revision and request UUID',async t=>{
 const f=await createRegistryStore(t);
 const send=createWorkspaceDispatch({storage:f.store as unknown as StoragePort});
 const peer={role:'client' as const,identity:'fixture',credentialId:'fixture'};
 const params={workspaceId:randomUUID(),requestId:randomUUID(),expectedStateRevision:'1'};
 const request={protocolVersion:1 as const,correlationId:randomUUID(),method:'workspace.refresh',params};
 const result=await send(request,peer,f.store.readSnapshot()!);
 assert.equal((result.data as {code:string}).code,'UNSUPPORTED_VERSION');
 validateWorkspaceParams(request.method,params);
 for(const overScope of [{holderId:randomUUID()},{generation:randomUUID()},{grantId:randomUUID()},{pid:process.pid},{expectedStateRevision:'0'}]){
   assert.throws(()=>validateWorkspaceParams(request.method,{...params,...overScope}),/INVALID_REQUEST/);
 }
 assert.throws(()=>validateWorkspaceParams('workspace.lease.acquire',params),/UNSUPPORTED_VERSION/);
 assert.throws(()=>workspaceCapabilities({workspaceVersion:1,workspaceMethods:['workspace.get']},request.method),/UNSUPPORTED_VERSION/);
});
