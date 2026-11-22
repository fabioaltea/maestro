import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {lstat,readFile,unlink,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {startSuccessor,workspaceRuntimeFixture} from '../fixtures/workspace-runtime.js';
import {createWorkspaceProvisioning} from '../../src/core/workspaces/provision.js';
import {createWorkspaceMutator} from '../../src/platform/macos/git/workspace-mutator.js';
import {createWorkspaceCleanup} from '../../src/core/workspaces/remove.js';

async function cleanupFixture(t:Parameters<typeof workspaceRuntimeFixture>[0],fault?:'after-worktree'|'after-branch'){
 const native=createWorkspaceMutator();
 const f=await workspaceRuntimeFixture(t,{...native,async removeWorktree(...args){
   await native.removeWorktree(...args);
   if(fault==='after-worktree')throw new Error('DEADLINE_EXCEEDED');
 },async deleteBranch(...args){
   const result=await native.deleteBranch(...args);
   if(fault==='after-branch')throw new Error('DEADLINE_EXCEEDED');
   return result;
 }},options=>{
   const provision=createWorkspaceProvisioning(options),cleanup=createWorkspaceCleanup(options);
   return{actions:{...provision.actions,...cleanup.actions},async recover(){await provision.recover();await cleanup.recover();}};
 });
 await f.repositories.git(f.repo,['pack-refs','--all']);
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
 await f.repositories.git(f.path,['commit','--allow-empty','-m','local workspace change']);
 const moved=(await f.repositories.git(f.repo,['rev-parse',f.branchRef])).trim();
 const notIntegrated=await f.prepare();
 assert.equal((notIntegrated.data as {code:string}).code,'UNINTEGRATED_WORK');
 assert.equal((await f.repositories.git(f.repo,['rev-parse',f.branchRef])).trim(),moved);

 await f.repositories.git(f.repo,['update-ref',f.targetRef,moved,f.baseOid]);
 const grant=await f.send('workspace.cleanup.prepare',{workspaceId:f.workspaceId,targetRef:f.targetRef,targetOid:moved});
 assert.equal(grant.result,'OK',JSON.stringify(grant));
 const evidence=await f.send('workspace.cleanup.get',{workspaceId:f.workspaceId});
 assert.equal((evidence.data as {eligible:boolean}).eligible,true);
 const packed=join(f.workspace.target.commonDirectory.canonicalPath,'packed-refs'),before=await readFile(packed);
 const action=await f.remove((grant.data as {grantId:string}).grantId);
 assert.equal(action.operation?.outcome,'SUCCEEDED',JSON.stringify(action.operation));
 await assert.rejects(lstat(f.path),{code:'ENOENT'});
 await f.repositories.git(f.repo,['show-ref','--exists',f.branchRef],2);
 assert.equal((await f.repositories.git(f.repo,['rev-parse',f.targetRef])).trim(),moved);
 assert.equal(f.store.readWorkspaceState({kind:'get',id:f.workspaceId}).workspace?.state,'REMOVED');
 assert.deepEqual(await readFile(packed),before);
 await assert.rejects(lstat(packed+'.lock'),{code:'ENOENT'});
 assert.ok(await f.files.readMarker(f.workspace.target.ownedRoot,f.workspaceId));
});

test('cleanup refuses a moved target or generated packed ref before touching the worktree',async t=>{
 const f=await cleanupFixture(t),prepared=await f.prepare();
 assert.equal(prepared.result,'OK');
 const tree=(await f.repositories.git(f.repo,['rev-parse','HEAD^{tree}'])).trim();
 const moved=(await f.repositories.git(f.repo,['commit-tree',tree,'-p',f.baseOid,'-m','move target'])).trim();
 await f.repositories.git(f.repo,['update-ref',f.targetRef,moved,f.baseOid]);
 const result=await f.remove((prepared.data as {grantId:string}).grantId);
 assert.equal(result.operation?.outcome,'BLOCKED');
 assert.equal(result.operation.error,'BASE_CHANGED');
 assert.equal(await readFile(join(f.path,'tracked.txt'),'utf8'),'base\n');
 await f.repositories.git(f.repo,['pack-refs','--all']);
 const rejected=await f.send('workspace.cleanup.prepare',{workspaceId:f.workspaceId,targetRef:f.targetRef,targetOid:moved});
 assert.equal((rejected.data as {code:string}).code,'WORKSPACE_UNSAFE');
 assert.ok((await lstat(f.path)).isDirectory());
 assert.equal((await f.repositories.git(f.repo,['rev-parse',f.branchRef])).trim(),f.baseOid);
});

test('partial cleanup preserves the branch, retains UNKNOWN and replays only the UUID',async t=>{
 const f=await cleanupFixture(t,'after-worktree'),prepared=await f.prepare(),grantId=(prepared.data as {grantId:string}).grantId;
 assert.equal(prepared.result,'OK',JSON.stringify(prepared));
 const result=await f.remove(grantId);
 assert.equal(result.operation?.outcome,'UNKNOWN');
 await assert.rejects(lstat(f.path),{code:'ENOENT'});
 assert.equal((await f.repositories.git(f.repo,['rev-parse',f.branchRef])).trim(),f.baseOid);
 const prior=(await f.remove(grantId,result.requestId)).operation;
 assert.deepEqual(prior,result.operation);
 assert.equal(f.store.readWorkspaceState({kind:'get',id:f.workspaceId}).workspace?.state,'RECONCILING');
});

test('restart after lost branch-delete acknowledgement finalizes only proven absence',async t=>{
 const f=await cleanupFixture(t,'after-branch'),prepared=await f.prepare();
 assert.equal(prepared.result,'OK');
 const result=await f.remove((prepared.data as {grantId:string}).grantId);
 assert.equal(result.operation?.outcome,'UNKNOWN');
 await f.repositories.git(f.repo,['show-ref','--exists',f.branchRef],2);
 const instanceId=startSuccessor(f);
 const recovery=createWorkspaceCleanup({storage:f.storage,paths:f.paths,instanceId,files:f.files,mutator:f.mutator,
   accepting:()=>false,schedule:()=>assert.fail('recovery must not enqueue Git mutations')});
 await recovery.recover();
 assert.equal(f.store.readFeatureState({kind:'operation',id:result.requestId}).operation?.outcome,'SUCCEEDED');
 assert.equal(f.store.readWorkspaceState({kind:'get',id:f.workspaceId}).workspace?.state,'REMOVED');
});
