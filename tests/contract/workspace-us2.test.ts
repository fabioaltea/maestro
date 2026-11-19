import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
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

test('workspace CLI refresh carries its revision and original UUID, and rejects a lease claim',async t=>{
 const f=await createRegistryStore(t),workspaceId=randomUUID(),requestId=randomUUID();
 const entry=fileURLToPath(new URL('../../../dist/cli/main.js',import.meta.url));
 const call=(...scope:string[])=>spawnSync(process.execPath,[entry,'workspace','refresh',workspaceId,'--request-id',requestId,
   '--state-dir',f.directory,'--json',...scope],{encoding:'utf8'});
 const failed=call('--expected-revision','2');
 const response=JSON.parse(failed.stdout);
 assert.equal(response.error.code,'DAEMON_UNAVAILABLE');
 assert.equal(response.requestId,requestId);
 for(const result of [call('--expected-revision','0'),call('--expected-revision','2','--grant',randomUUID()),call('--holder',randomUUID())]){
   assert.equal(result.status,2);assert.equal(JSON.parse(result.stdout).error.code,'INVALID_REQUEST');
 }
});
