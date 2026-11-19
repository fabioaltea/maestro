import test from 'node:test';
import assert from 'node:assert/strict';
import {lstat,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {workspaceRuntimeFixture} from '../fixtures/workspace-runtime.js';
import {createWorkspaceMutator} from '../../src/platform/macos/git/workspace-mutator.js';


test('two feature workspaces branch from the current approved base, with reply loss safe and checkout preserved',async t=>{
 const f=await workspaceRuntimeFixture(t);
 const initial=await readFile(join(f.repo,'tracked.txt'),'utf8');
 await writeFile(join(f.repo,'untracked.txt'),'my local file');
 const first=await f.prepare(),wrong=await f.send('workspace.remove',{grantId:first.data.grantId,requestId:randomUUID(),expectedStateRevision:'1'});
 assert.notEqual(wrong.result,'OK');
 const one=await f.submit(first.data.grantId);
 assert.equal(one.operation?.outcome,'SUCCEEDED',JSON.stringify(one.r));
 const revision=f.store.readSnapshot()!.store.revision;
 assert.deepEqual((await f.submit(first.data.grantId,one.requestId)).operation,one.operation);
 assert.equal(f.store.readSnapshot()!.store.revision,revision);
 const second=await f.prepare(),two=await f.submit(second.data.grantId);
 assert.equal(two.operation?.outcome,'SUCCEEDED',JSON.stringify(two.r));
 for(const receipt of [first,second]){
   const workspace=f.store.readWorkspaceState({kind:'get',id:receipt.data.summary.workspaceId}).workspace!;
   assert.equal(workspace.state,'READY');assert.equal(workspace.ownership?.headOid,f.baseOid);assert.ok(workspace.markerDigest);
   assert.equal((await f.repositories.git(f.repo,['rev-parse',receipt.data.summary.branchRef])).trim(),f.baseOid);
 }
 assert.equal(await readFile(join(f.repo,'tracked.txt'),'utf8'),initial);
 assert.equal(await readFile(join(f.repo,'untracked.txt'),'utf8'),'my local file');
});

test('moving the configured base after prepare leaves both generated ref and path absent',async t=>{
 const f=await workspaceRuntimeFixture(t),approved=await f.prepare();
 const tree=(await f.repositories.git(f.repo,['rev-parse','HEAD^{tree}'])).trim();
 const moved=(await f.repositories.git(f.repo,['commit-tree',tree,'-p',f.baseOid,'-m','base moved'])).trim();
 await f.repositories.git(f.repo,['update-ref',`refs/heads/${f.project.baseBranch}`,moved,f.baseOid]);
 const result=await f.submit(approved.data.grantId);
 assert.equal(result.operation?.outcome,'BLOCKED',JSON.stringify(result.r));
 assert.equal(result.operation?.error,'BASE_CHANGED');
 assert.equal(await f.repositories.git(f.repo,['show-ref','--exists',approved.data.summary.branchRef],2),'');
 const workspace=f.store.readWorkspaceState({kind:'get',id:approved.data.summary.workspaceId}).workspace!;
 await assert.rejects(lstat(join(workspace.target.ownedRoot.canonicalPath,workspace.workspaceId)),{code:'ENOENT'});
 assert.equal((await f.send('workspace.get',{workspaceId:approved.data.summary.workspaceId})).result,'OK');
});

test('a lost acknowledgement after branch creation preserves the partial branch and repository reservation',async t=>{
 const native=createWorkspaceMutator();
 const f=await workspaceRuntimeFixture(t,{...native,async createBranch(target,deadline){
   await native.createBranch(target,deadline);
   throw new Error('DEADLINE_EXCEEDED');
 }});
 const first=await f.prepare(),result=await f.submit(first.data.grantId);
 assert.equal(result.operation?.outcome,'UNKNOWN');
 assert.equal((await f.repositories.git(f.repo,['rev-parse',first.data.summary.branchRef])).trim(),f.baseOid);
 const {workspace}=f.store.readWorkspaceState({kind:'get',id:first.data.summary.workspaceId});
 assert.equal(workspace?.state,'RECONCILING');
 assert.equal(workspace.ownership,null);
 const operation=await f.send('workspace.operation.get',{requestId:result.requestId});
 assert.equal(operation.result,'UNKNOWN_OUTCOME');
 const next=await f.prepare(),attempt=await f.submit(next.data.grantId);
 assert.equal((attempt.r.data as {code:string}).code,'WORKSPACE_IN_USE');
});
