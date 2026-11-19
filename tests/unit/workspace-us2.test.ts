import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {FilesystemAnchor} from '../../src/ports/repository.js';

const ownershipModule='../../src/domain/workspaces/ownership.js';
const anchor=(path:string,inode:string,kind:FilesystemAnchor['kind']='directory'):FilesystemAnchor=>
 ({version:1,canonicalPath:path,device:'1',inode,birthtimeNs:'2000',kind});

test('workspace identity tolerates a new commit while rejecting moved or replaced anchors',async()=>{
 const {requireMatchingWorktree}=await import(ownershipModule);
 const original={root:anchor('/private/worktree','2'),adminDirectory:anchor('/repo/.git/worktrees/worktree','3'),
   gitFile:anchor('/private/worktree/.git','4','file'),branchRef:'refs/heads/maestro/feature/generated',headOid:'a'.repeat(40)};
 requireMatchingWorktree(original,{...original,headOid:'b'.repeat(40)});
 assert.throws(()=>requireMatchingWorktree(original,{...original,root:{...original.root,canonicalPath:'/private/moved'}}),/OWNERSHIP_UNPROVEN/);
 assert.throws(()=>requireMatchingWorktree(original,{...original,gitFile:{...original.gitFile,inode:'5'}}),/OWNERSHIP_UNPROVEN/);
 assert.throws(()=>requireMatchingWorktree(original,null),/OWNERSHIP_UNPROVEN/);
});

test('release proof is scoped to a holder, instance and generation and proves quiescence',async()=>{
 const {requireWorkspaceRelease}=await import(ownershipModule);
 const lease={leaseId:randomUUID(),workspaceId:randomUUID(),holderType:'ENVIRONMENT',holderId:randomUUID(),generation:randomUUID(),instanceId:randomUUID()};
 const proof={...lease,kind:'EXIT',hostExited:true,descendantsExited:true};
 requireWorkspaceRelease(lease,proof);
 assert.throws(()=>requireWorkspaceRelease(lease,{...proof,generation:randomUUID()}),/STALE_TARGET/);
 assert.throws(()=>requireWorkspaceRelease(lease,{...proof,instanceId:randomUUID()}),/STALE_TARGET/);
 assert.throws(()=>requireWorkspaceRelease(lease,{...proof,descendantsExited:false,pid:process.pid}),/RESOURCE_IDENTITY_UNKNOWN/);
 assert.throws(()=>requireWorkspaceRelease(lease,{...lease,kind:'PID_ABSENT',pid:process.pid}),/RESOURCE_IDENTITY_UNKNOWN/);
 requireWorkspaceRelease(lease,{...lease,kind:'CHECKPOINT',durable:true,quiescent:true});
});
