import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,unlink,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'node:test';
import {createIntegrationMutator} from '../../src/platform/macos/git/integration-mutator.js';
import {reviewBoundaryFixture} from '../fixtures/review-boundary.js';
import {reviewIntegrationFixture} from '../fixtures/review-integration.js';

type Fixture=Awaited<ReturnType<typeof reviewBoundaryFixture>>;
async function diverge(f:Fixture,conflict:boolean){
 const target=join(f.root,'target-fixture');
 await f.git(f.repo,['worktree','add',target,'local-integration']);
 const name=conflict?f.relative:'target-only.txt';
 await writeFile(join(target,name),'target fixture content\n');
 await f.git(target,['add','--',name]);
 await f.git(target,['commit','-m','fixture divergence']);
 const targetOid=await f.git(target,['rev-parse','HEAD']);
 await f.git(f.repo,['worktree','remove',target]);
 return{...f.scope,targetOid,stagingId:randomUUID(),authoredAt:'2026-11-20T11:00:00.000Z'};
}

test('a divergent candidate has both parents and an attributable CAS across fault and retry',async t=>{
 const f=await reviewBoundaryFixture(t),input=await diverge(f,false);
 let fault:'ref.intent'|'ref.updated'|null=null;
 const git=createIntegrationMutator({checkpoint(point){if(point===fault)throw new Error('FIXTURE_FAULT');}});
 const guard=await git.reserveGuard(input,f.deadline());
 const result=await git.prepareCandidate(input,guard,f.deadline());
 assert.equal(result.kind,'READY');
 assert.ok(result.kind==='READY');
 const {candidate}=result,staging=candidate.staging.root.canonicalPath,requestId=randomUUID();
 const proof={requestId,old:input.targetOid,candidate:candidate.candidateOid};
 assert.equal(await f.git(staging,['rev-list','--parents','-n','1','HEAD']),`${candidate.candidateOid} ${input.targetOid} ${input.sourceOid}`);
 assert.equal(await f.git(staging,['rev-parse','HEAD^{tree}']),candidate.treeOid);
 assert.equal(await f.git(staging,['status','--porcelain']),'');
 const publish=()=>git.publishCandidate(input,guard,candidate,requestId,f.deadline());
 fault='ref.intent';
 await assert.rejects(publish(),/FIXTURE_FAULT/);
 assert.deepEqual(await git.observePublication(input,guard,proof,f.deadline()),{targetOid:input.targetOid,proof:null});
 fault='ref.updated';
 await assert.rejects(publish(),/FIXTURE_FAULT/);
 assert.deepEqual(await git.observePublication(input,guard,proof,f.deadline()),{targetOid:candidate.candidateOid,proof});
 assert.equal((await git.observePublication(input,guard,{...proof,requestId:randomUUID()},f.deadline())).proof,null);
 await assert.rejects(publish(),/TARGET_MOVED/);
 const injected=join(guard.root.canonicalPath,'keep.txt');
 await writeFile(injected,'preserved');
 await assert.rejects(git.syncGuard(input,guard,f.deadline(),candidate.candidateOid),/INTEGRATION_UNKNOWN/);
 assert.equal(await readFile(injected,'utf8'),'preserved');
 const {unlink}=await import('node:fs/promises');
 await unlink(injected);
 await git.syncGuard(input,guard,f.deadline(),candidate.candidateOid);
 await git.syncGuard(input,guard,f.deadline(),candidate.candidateOid);
 assert.equal(await f.guardContent(guard.root.canonicalPath),'approved synthetic content\n');
 assert.equal(await f.git(f.cwd,['rev-parse','HEAD']),input.sourceOid);
 assert.equal(await f.git(f.repo,['status','--porcelain']),'');
});

test('merge conflict preserves the detached conflict worktree, source and target',async t=>{
 const f=await reviewBoundaryFixture(t),input=await diverge(f,true),git=createIntegrationMutator();
 const guard=await git.reserveGuard(input,f.deadline()),result=await git.prepareCandidate(input,guard,f.deadline());
 assert.equal(result.kind,'CONFLICT');
 assert.ok(result.kind==='CONFLICT');
 const stage=result.staging.root.canonicalPath;
 assert.match(await f.git(stage,['status','--porcelain']),/AA new-review-file\.txt/);
 assert.match(await readFile(join(stage,f.relative),'utf8'),/<<<<<<< HEAD/);
 assert.equal(await f.git(f.repo,['rev-parse',input.targetRef]),input.targetOid);
 assert.equal(await f.git(f.cwd,['rev-parse','HEAD']),input.sourceOid);
 assert.equal(await f.git(f.repo,['status','--porcelain']),'');
});

test('candidate ownership, 007 evidence and distinct grants survive daemon loss after CAS',async t=>{
 await reviewIntegrationFixture(t);
});
