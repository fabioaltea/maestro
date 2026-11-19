import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {lstat,readFile,unlink,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {workspaceRuntimeFixture} from '../fixtures/workspace-runtime.js';
import {createWorkspaceProvisioning} from '../../src/core/workspaces/provision.js';
import {createWorkspaceMutator} from '../../src/platform/macos/git/workspace-mutator.js';

const cleanupModule='../../src/core/workspaces/remove.js';
async function cleanupFixture(t:Parameters<typeof workspaceRuntimeFixture>[0],partial=false){
 const {createWorkspaceCleanup}=await import(cleanupModule);
 const native=createWorkspaceMutator();
 const f=await workspaceRuntimeFixture(t,partial?{...native,async removeWorktree(...args){
   await native.removeWorktree(...args);throw new Error('DEADLINE_EXCEEDED');
 }}:native,options=>{
   const provision=createWorkspaceProvisioning(options),cleanup=createWorkspaceCleanup(options);
   return{actions:{...provision.actions,...cleanup.actions},async recover(){await provision.recover();await cleanup.recover();}};
 });
 const receipt=await f.prepare();
 assert.equal((await f.submit(receipt.data.grantId)).operation?.outcome,'SUCCEEDED');
 const {workspaceId,branchRef}=receipt.data.summary,targetRef=`refs/heads/${f.project.baseBranch}`;
 const workspace=f.store.readWorkspaceState({kind:'get',id:workspaceId}).workspace!;
 const path=workspace.ownership!.root.canonicalPath;
 const prepare=()=>f.send('workspace.cleanup.prepare',{workspaceId,targetRef,targetOid:f.baseOid});
 async function remove(grantId:string,requestId=randomUUID()){
   const response=await f.send('workspace.remove',{grantId,requestId,expectedStateRevision:workspace.stateRevision});
   await f.runtime.idle();
   return{response,requestId,operation:f.store.readFeatureState({kind:'operation',id:requestId}).operation};
 }
 return{...f,workspaceId,workspace,path,branchRef,targetRef,prepare,remove,createGrant:receipt.data.grantId};
}

test('cleanup rejects dirty and unintegrated work, then removes an integrated clean worktree and generated branch',async t=>{
 const f=await cleanupFixture(t),untracked=join(f.path,'keep');
 await writeFile(untracked,'untouched');
 const dirty=await f.prepare();
 assert.equal((dirty.data as {code:string}).code,'UNINTEGRATED_WORK');
 assert.equal(await readFile(untracked,'utf8'),'untouched');
 await unlink(untracked);
 assert.equal((await f.remove(f.createGrant)).response.result,'ERROR');
 await f.repositories.git(f.repo,['-C',f.path,'commit','--allow-empty','-m','local workspace change']);
 const moved=(await f.repositories.git(f.repo,['rev-parse',f.branchRef])).trim();
 const notIntegrated=await f.prepare();
 assert.equal((notIntegrated.data as {code:string}).code,'UNINTEGRATED_WORK');
 assert.equal((await f.repositories.git(f.repo,['rev-parse',f.branchRef])).trim(),moved);

 await f.repositories.git(f.repo,['update-ref',f.targetRef,moved,f.baseOid]);
 const grant=await f.send('workspace.cleanup.prepare',{workspaceId:f.workspaceId,targetRef:f.targetRef,targetOid:moved});
 assert.equal(grant.result,'OK',JSON.stringify(grant));
 const action=await f.remove((grant.data as {grantId:string}).grantId);
 assert.equal(action.operation?.outcome,'SUCCEEDED',JSON.stringify(action.response));
 await assert.rejects(lstat(f.path),{code:'ENOENT'});
 await f.repositories.git(f.repo,['show-ref','--exists',f.branchRef],2);
 assert.equal((await f.repositories.git(f.repo,['rev-parse',f.targetRef])).trim(),moved);
 assert.equal(f.store.readWorkspaceState({kind:'get',id:f.workspaceId}).workspace?.state,'REMOVED');
 assert.ok(await f.files.readMarker(f.workspace.target.ownedRoot,f.workspaceId));
});

test('partial cleanup preserves the branch, retains UNKNOWN and replays only the UUID',async t=>{
 const f=await cleanupFixture(t,true),prepared=await f.prepare(),grantId=(prepared.data as {grantId:string}).grantId;
 assert.equal(prepared.result,'OK',JSON.stringify(prepared));
 const result=await f.remove(grantId);
 assert.equal(result.operation?.outcome,'UNKNOWN');
 await assert.rejects(lstat(f.path),{code:'ENOENT'});
 assert.equal((await f.repositories.git(f.repo,['rev-parse',f.branchRef])).trim(),f.baseOid);
 const prior=(await f.remove(grantId,result.requestId)).operation;
 assert.deepEqual(prior,result.operation);
 assert.equal(f.store.readWorkspaceState({kind:'get',id:f.workspaceId}).workspace?.state,'RECONCILING');
});
