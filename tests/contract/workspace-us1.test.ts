import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createWorkspaceDispatch} from '../../src/core/workspaces/dispatch.js';
import {inspectWorkspace} from '../../src/core/inspect-main.js';
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

test('workspace CLI and offline API agree on pages, and CLI rejects extra scope without echoing it',async t=>{
 const f=await createRegistryStore(t),projectId=randomUUID();
 const entry=fileURLToPath(new URL('../../../dist/cli/main.js',import.meta.url));
 const flags=['--state-dir',f.directory,'--json'];
 const viaCli=JSON.parse(execFileSync(process.execPath,[entry,'workspace','list',projectId,'--limit','1',...flags],{encoding:'utf8'}));
 const viaApi=await inspectWorkspace(f.directory,'workspace.list',{projectId,limit:1});
 assert.deepEqual(viaCli,viaApi);
 const requestId=randomUUID(),extra='private-command-sentinel';
 const malformed=spawnSync(process.execPath,[entry,'workspace','create','--grant',randomUUID(),'--request-id',requestId,extra,...flags],{encoding:'utf8'});
 assert.equal(malformed.status,2);assert.equal(JSON.parse(malformed.stdout).error.code,'INVALID_REQUEST');
 assert.ok(!malformed.stdout.includes(extra));
 const mutation=spawnSync(process.execPath,[entry,'workspace','create','--grant',randomUUID(),'--request-id',requestId,...flags],{encoding:'utf8'});
 const rejected=JSON.parse(mutation.stdout);
 assert.notEqual(mutation.status,0);
 assert.equal(rejected.error.code,'DAEMON_UNAVAILABLE');
 assert.equal(rejected.requestId,requestId);
});
