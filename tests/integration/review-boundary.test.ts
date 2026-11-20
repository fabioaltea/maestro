import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {reviewBoundaryFixture} from '../fixtures/review-boundary.js';

const adapter='../../src/platform/macos/git/integration-mutator.js';
test('G0 preflight rejects dirty, ignored, occupied and moved targets',async t=>{
 const {createIntegrationMutator}=await import(adapter),f=await reviewBoundaryFixture(t),git=createIntegrationMutator();
 assert.equal((await git.preflight(f.scope,f.deadline())).sourceOid,f.scope.sourceOid);
 await writeFile(join(f.cwd,'extra.txt'),'unfinished');
 await assert.rejects(git.preflight(f.scope,f.deadline()),/SOURCE_NOT_QUIESCENT/);
 await f.git(f.cwd,['add','--','extra.txt']);await f.git(f.cwd,['commit','-m','fixture change']);
 const sourceOid=await f.git(f.cwd,['rev-parse','HEAD']);
 const current={...f.scope,sourceOid};
 await writeFile(join(f.scope.source.commonDirectory.canonicalPath,'info','exclude'),'ignored-for-review\n');
 await writeFile(join(f.cwd,'ignored-for-review'),'private ignored fixture');
 await assert.rejects(git.preflight(current,f.deadline()),/SOURCE_NOT_QUIESCENT/);
 const {unlink}=await import('node:fs/promises');await unlink(join(f.cwd,'ignored-for-review'));
 await f.git(f.repo,['worktree','add',join(f.root,'external-target'),'local-integration']);
 await assert.rejects(git.preflight(current,f.deadline()),/TARGET_IN_USE/);
 await f.git(f.repo,['worktree','remove',join(f.root,'external-target')]);
 await f.git(f.cwd,['update-ref',current.targetRef,sourceOid,current.targetOid]);
 await assert.rejects(git.preflight(current,f.deadline()),/TARGET_MOVED/);
});

test('G0 guard prevents normal competing checkout, disables hooks, and syncs only its exact approved tree',async t=>{
 const {createIntegrationMutator}=await import(adapter),f=await reviewBoundaryFixture(t),git=createIntegrationMutator();
 const marker=join(f.root,'fixture-hook-ran');
 await writeFile(join(f.scope.source.commonDirectory.canonicalPath,'hooks','post-checkout'),`#!/bin/sh\n: > "${marker}"\n`,{mode:0o700});
 const guard=await git.reserveGuard(f.scope,f.deadline());
 await assert.rejects(readFile(marker),{code:'ENOENT'});
 await assert.rejects(f.git(f.repo,['worktree','add',join(f.root,'other-guard'),'local-integration']));
 const proof=await git.publishFastForward(f.scope,guard,f.deadline());
 assert.equal(proof.resultingOid,f.scope.sourceOid);
 assert.equal(await f.git(f.repo,['rev-parse',f.scope.targetRef]),f.scope.sourceOid);
 await assert.rejects(f.guardContent(guard.root.canonicalPath),{code:'ENOENT'});
 await git.syncGuard(f.scope,guard,f.deadline());
 assert.equal(await f.guardContent(guard.root.canonicalPath),'approved synthetic content\n');
 assert.equal(await f.git(guard.root.canonicalPath,['status','--porcelain']),'');
 await assert.rejects(readFile(join(f.repo,f.relative)),{code:'ENOENT'});
});

test('G0 fault after CAS preserves ref evidence and refuses changed guard sync',async t=>{
 const {createIntegrationMutator}=await import(adapter),f=await reviewBoundaryFixture(t);
 const git=createIntegrationMutator({checkpoint:(point:string)=>{if(point==='ref.updated')throw new Error('FIXTURE_FAULT');}});
 const guard=await git.reserveGuard(f.scope,f.deadline());
 await assert.rejects(git.publishFastForward(f.scope,guard,f.deadline()),/FIXTURE_FAULT/);
 assert.equal(await f.git(f.repo,['rev-parse',f.scope.targetRef]),f.scope.sourceOid);
 const local=join(guard.root.canonicalPath,'unfinished.txt');
 await writeFile(local,'keep local changes');
 await assert.rejects(git.syncGuard(f.scope,guard,f.deadline()),/INTEGRATION_UNKNOWN/);
 assert.equal(await readFile(local,'utf8'),'keep local changes');
});
