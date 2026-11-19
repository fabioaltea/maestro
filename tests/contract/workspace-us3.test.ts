import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {validateWorkspaceParams,workspaceCapabilities} from '../../src/protocol/workspace.js';
import {createWorkspaceDispatch} from '../../src/core/workspaces/dispatch.js';
import {createRegistryStore} from '../fixtures/registry-store.js';
import type {StoragePort} from '../../src/ports/storage.js';

test('cleanup exposes only approval of a local exact target and a versioned remove grant',async t=>{
 const f=await createRegistryStore(t),workspaceId=randomUUID(),targetRef='refs/heads/main',targetOid='a'.repeat(64),requestId=randomUUID(),grantId=randomUUID();
 const prepared={workspaceId,targetRef,targetOid};
 validateWorkspaceParams('workspace.cleanup.prepare',prepared);
 validateWorkspaceParams('workspace.remove',{requestId,grantId,expectedStateRevision:'1'});
 for(const scope of [{force:true},{path:'/tmp/checkout'},{targetRef:'refs/remotes/origin/main'},{targetOid:'HEAD'}]){
   assert.throws(()=>validateWorkspaceParams('workspace.cleanup.prepare',{...prepared,...scope}),/INVALID_REQUEST/);
 }
 assert.throws(()=>validateWorkspaceParams('workspace.remove',{requestId,grantId,expectedStateRevision:'1',...prepared}),/INVALID_REQUEST/);
 assert.throws(()=>workspaceCapabilities({workspaceVersion:1,workspaceMethods:['workspace.cleanup.get']},'workspace.remove'),/UNSUPPORTED_VERSION/);
 const dispatch=createWorkspaceDispatch({storage:f.store as unknown as StoragePort});
 const result=await dispatch({method:'workspace.cleanup.prepare',protocolVersion:1,correlationId:randomUUID(),params:prepared},
   {role:'client',credentialId:'fixture',identity:'fixture'},f.store.readSnapshot()!);
 assert.equal((result.data as {code:string}).code,'UNSUPPORTED_VERSION');
});

test('cleanup CLI carries explicit target in bounded stdin and preserves the removal UUID',async t=>{
 const f=await createRegistryStore(t);
 const entry=fileURLToPath(new URL('../../../dist/cli/main.js',import.meta.url));
 const scope={workspaceId:randomUUID(),targetRef:'refs/heads/main',targetOid:'a'.repeat(40)};
 const flags=['--state-dir',f.directory,'--json'];
 const prepare=(input:unknown)=>spawnSync(process.execPath,[entry,'workspace','cleanup','prepare','--input-stdin',...flags],
   {encoding:'utf8',input:JSON.stringify(input)});
 assert.equal(JSON.parse(prepare(scope).stdout).error.code,'DAEMON_UNAVAILABLE');
 const rejected=prepare({...scope,reason:'private fixture text'});
 assert.equal(JSON.parse(rejected.stdout).error.code,'INVALID_REQUEST');
 assert.ok(!rejected.stdout.includes('private fixture text'));
 const requestId=randomUUID();
 const removed=spawnSync(process.execPath,[entry,'workspace','remove','--request-id',requestId,'--grant',randomUUID(),
   '--expected-revision','2',...flags],{encoding:'utf8'});
 assert.equal(JSON.parse(removed.stdout).requestId,requestId);
 assert.equal(JSON.parse(removed.stdout).error.code,'DAEMON_UNAVAILABLE');
});
