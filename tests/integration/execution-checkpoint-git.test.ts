import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {workspaceRuntimeFixture} from '../fixtures/workspace-runtime.js';
import {verifyOwnedWorktree} from '../../src/core/workspaces/leases.js';
import {createExecutionCheckpointCapture} from '../../src/platform/macos/git/execution-commit.js';

test('pinned Git builds a bounded portable patch without touching worktree refs or index',async t=>{
 const f=await workspaceRuntimeFixture(t),created=await f.prepare();
 assert.equal((await f.submit(created.data.grantId)).operation?.outcome,'SUCCEEDED');
 const w=f.store.readWorkspaceState({kind:'get',id:created.data.summary.workspaceId}).workspace!;
 const root=w.ownership!.root.canonicalPath,added=join(root,'local.txt'),index=join(w.ownership!.adminDirectory.canonicalPath,'index');
 const before=await readFile(index);
 await writeFile(added,'contenuto locale',{mode:0o600});
 const capture=createExecutionCheckpointCapture(f.mutator,w=>verifyOwnedWorktree(f,f.storeId,w));
 const one=await capture(w),document=JSON.parse(Buffer.from(one.patch).toString());
 assert.equal(document.baseOid,w.ownership?.headOid);
 assert.deepEqual(document.untracked.map((f:{path:string})=>f.path),['local.txt']);
 assert.equal(Buffer.from(document.untracked[0].base64,'base64').toString(),'contenuto locale');
 await writeFile(added,'modifica diversa');
 const two=await capture(w);
 assert.notEqual(one.treeDigest,two.treeDigest);
 assert.deepEqual(await readFile(index),before);
});
