import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {access,chmod,mkdir,readFile,rename,symlink,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createWorkspaceMutator} from '../../src/platform/macos/git/workspace-mutator.js';
import {workspaceBoundary} from '../fixtures/workspace-boundary.js';

async function absent(path:string){
  await assert.rejects(access(path),{code:'ENOENT'});
}

test('G0 pins native Git and provisions an exact commit without changing dirty reference files',async t=>{
  for(const format of ['sha1','sha256'] as const){
    const f=await workspaceBoundary(t,format),m=createWorkspaceMutator();
    const pin=await m.qualification();
    assert.equal(pin.version,'git version 2.50.1 (Apple Git-155)');
    assert.match(pin.sha256,/^[0-9a-f]{64}$/);
    await f.repositories.makeDirty(f.checkout);
    const original=await readFile(join(f.checkout,'tracked.txt'),'utf8');
    const index=await readFile(join(f.checkout,'.git','index'));
    await m.createBranch(f.request,f.deadline());
    await m.addWorktree(f.request,f.deadline());
    const result=await m.observe(f.request,f.deadline());
    assert.equal(result.branchOid,f.request.baseOid);
    assert.equal(result.worktree?.headOid,f.request.baseOid);
    assert.equal(result.worktree?.branchRef,f.ref);
    assert.equal(await readFile(join(f.path,'tracked.txt'),'utf8'),'base\n');
    assert.equal(await readFile(join(f.checkout,'tracked.txt'),'utf8'),original);
    assert.equal(await readFile(join(f.checkout,'untracked.txt'),'utf8'),'untracked content\n');
    assert.deepEqual(await readFile(join(f.checkout,'.git','index')),index);
  }
});

test('G0 rejects Git includes and executable configuration before branch creation',async t=>{
  const f=await workspaceBoundary(t),m=createWorkspaceMutator(),sentinel=await f.repositories.createSentinel('configured');
  const config=join(f.checkout,'.git','config'),original=await readFile(config,'utf8');
  for(const addition of [
    '[include]\n path = /dev/null\n',
    `[filter "outside"]\n smudge = ${sentinel.command}\n`,
    `[diff "outside"]\n command = ${sentinel.command}\n`,
    `[alias]\n external = !${sentinel.command}\n`,
  ]){
    await writeFile(config,original+addition);
    await assert.rejects(m.createBranch(f.request,f.deadline()),/WORKSPACE_UNSAFE/);
    await absent(f.path);
    await absent(sentinel.marker);
    assert.equal(await f.repositories.git(f.checkout,['show-ref','--exists',f.ref],2),'');
  }
});

test('G0 disables repository hooks and fsmonitor even when present in the checkout metadata',async t=>{
  const f=await workspaceBoundary(t),m=createWorkspaceMutator(),sentinel=await f.repositories.createSentinel('checkout-hook');
  const hooks=join(f.checkout,'.git','hooks');
  await writeFile(join(hooks,'post-checkout'),await readFile(sentinel.script),{mode:0o700});
  await chmod(join(hooks,'post-checkout'),0o700);
  await f.repositories.git(f.checkout,['config','core.hooksPath',hooks]);
  await f.repositories.git(f.checkout,['config','core.fsmonitor',sentinel.script]);
  await m.createBranch(f.request,f.deadline());
  await m.addWorktree(f.request,f.deadline());
  await absent(sentinel.marker);
  assert.equal(await readFile(join(f.path,'tracked.txt'),'utf8'),'base\n');
});

test('G0 rejects branch collision, stale base, replaced root and an occupied symlink target',async t=>{
  const f=await workspaceBoundary(t),m=createWorkspaceMutator();
  await assert.rejects(m.createBranch({...f.request,baseOid:'1'.repeat(40)},f.deadline()),/BASE_CHANGED/);
  const outside=join(f.repositories.directory,'outside');
  await mkdir(outside,{mode:0o700});
  const marker=join(outside,'owner.txt');
  await writeFile(marker,'preserve');
  await symlink(outside,f.path);
  await assert.rejects(m.createBranch(f.request,f.deadline()),/OWNERSHIP_UNPROVEN/);
  assert.equal(await readFile(marker,'utf8'),'preserve');
  await rename(f.root,join(f.repositories.directory,'original-root'));
  await symlink(outside,f.root);
  await assert.rejects(m.createBranch(f.request,f.deadline()),/OWNERSHIP_UNPROVEN/);
  assert.equal(await readFile(marker,'utf8'),'preserve');
  const next=await workspaceBoundary(t);
  await m.createBranch(next.request,next.deadline());
  await assert.rejects(m.createBranch(next.request,next.deadline()),/BRANCH_EXISTS/);
  await absent(next.path);
});

for(const point of ['before-add','after-add'] as const){
  test(`G0 observes branch/worktree evidence after SIGKILL at ${point}`,async t=>{
    const f=await workspaceBoundary(t);
    const file=join(f.repositories.directory,'workspace-intent.json');
    await writeFile(file,JSON.stringify({point,request:f.request}));
    const actor=fileURLToPath(new URL('../fixtures/workspace-adapter.js',import.meta.url));
    const child=f.repositories.context.spawnNode([actor,file]);
    const [message]=await Promise.race([once(child,'message'),once(child,'exit').then(([code])=>{throw new Error(`Actor exited before checkpoint: ${code}`);})]);
    assert.equal(message,point);
    const exited=once(child,'exit');
    child.kill('SIGKILL');
    assert.deepEqual(await exited,[null,'SIGKILL']);
    const observation=await createWorkspaceMutator().observe(f.request,f.deadline());
    assert.equal(observation.branchOid,f.request.baseOid);
    if(point==='after-add')assert.equal(observation.worktree?.headOid,f.request.baseOid);
    else {assert.equal(observation.worktree,null);await absent(f.path);}
  });
}

test('G0 removes a clean integrated worktree with its branch still recoverable',async t=>{
  const f=await workspaceBoundary(t),m=createWorkspaceMutator();
  await m.createBranch(f.request,f.deadline());
  const result=await m.addWorktree(f.request,f.deadline());
  await m.removeWorktree(f.request,result.worktree!,{targetRef:f.request.baseRef,targetOid:f.request.baseOid},f.deadline());
  await absent(f.path);
  await absent(f.admin);
  assert.equal((await m.observe(f.request,f.deadline())).branchOid,f.request.baseOid);
});

test('G0 preserves an ignored file that appears after cleanup inventory',async t=>{
  const f=await workspaceBoundary(t);
  const unexpected=join(f.path,'late.owned-by-user');
  const m=createWorkspaceMutator({beforeRemove:()=>writeFile(unexpected,'preserve new work')});
  await writeFile(join(f.checkout,'.git','info','exclude'),'late.owned-by-user\n');
  await m.createBranch(f.request,f.deadline());
  const result=await m.addWorktree(f.request,f.deadline());
  await assert.rejects(m.removeWorktree(f.request,result.worktree!,
    {targetRef:f.request.baseRef,targetOid:f.request.baseOid},f.deadline()),/OWNERSHIP_UNPROVEN/);
  assert.equal(await readFile(unexpected,'utf8'),'preserve new work');
  assert.equal((await f.repositories.git(f.checkout,['rev-parse','--verify',f.ref])).trim(),f.request.baseOid);
});
