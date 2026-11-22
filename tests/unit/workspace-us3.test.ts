import test from 'node:test';
import assert from 'node:assert/strict';

import {requireCleanupConditions,requireCleanupEffect} from '../../src/domain/workspaces/cleanup.js';
const status={tracked:false,untracked:false,ignored:false,conflicts:false};
const baseOid='a'.repeat(40),otherOid='b'.repeat(40);

test('cleanup requires all current conditions and preserves untracked, ignored and unintegrated work',()=>{
 const clean={state:'READY' as const,holder:false,effect:false,targetOid:baseOid,observedTargetOid:baseOid,integrated:true,status};
 requireCleanupConditions(clean);
 for(const key of Object.keys(status)){
   assert.throws(()=>requireCleanupConditions({...clean,status:{...status,[key]:true}}),key==='conflicts'?/GIT_CONFLICT/:/UNINTEGRATED_WORK/);
 }
 assert.throws(()=>requireCleanupConditions({...clean,integrated:false}),/UNINTEGRATED_WORK/);
 assert.throws(()=>requireCleanupConditions({...clean,holder:true}),/WORKSPACE_IN_USE/);
 assert.throws(()=>requireCleanupConditions({...clean,effect:true}),/WORKSPACE_IN_USE/);
 assert.throws(()=>requireCleanupConditions({...clean,observedTargetOid:otherOid}),/BASE_CHANGED/);
 assert.throws(()=>requireCleanupConditions({...clean,status:null}),/OWNERSHIP_UNPROVEN/);
});

test('cleanup distinguishes the preserved branch after removal from proof of full absence',()=>{
 requireCleanupEffect({worktree:null,branchOid:baseOid},baseOid,'WORKTREE_REMOVED');
 assert.throws(()=>requireCleanupEffect({worktree:null,branchOid:null},baseOid,'WORKTREE_REMOVED'),/OWNERSHIP_UNPROVEN/);
 assert.throws(()=>requireCleanupEffect({worktree:null,branchOid:otherOid},baseOid,'WORKTREE_REMOVED'),/OWNERSHIP_UNPROVEN/);
 requireCleanupEffect({worktree:null,branchOid:null},baseOid,'BRANCH_REMOVED');
 assert.throws(()=>requireCleanupEffect({worktree:null,branchOid:baseOid},baseOid,'BRANCH_REMOVED'),/OWNERSHIP_UNPROVEN/);
});
