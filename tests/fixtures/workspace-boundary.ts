import {randomUUID} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import type {TestContext} from 'node:test';
import {makeDeadline,systemClock} from '../../src/ports/clock.js';
import {createFilesystemIdentity} from '../../src/platform/macos/git/filesystem-identity.js';
import {createProjectRepositories} from './project-repositories.js';

export const workspaceMutatorModule='../../src/platform/macos/git/workspace-mutator.js';

export async function workspaceBoundary(t:TestContext,objectFormat:'sha1'|'sha256'='sha1'){
  const repositories=await createProjectRepositories(t);
  const checkout=await repositories.createRepository('reference',{objectFormat});
  const root=join(repositories.directory,'owned');
  await mkdir(root,{mode:0o700});
  const filesystem=createFilesystemIdentity(),common=join(checkout,'.git');
  const reference=await filesystem.capture(checkout,'directory'),commonDirectory=await filesystem.capture(common,'directory');
  const ownedRoot=await filesystem.capture(root,'directory');
  const workspaceId=randomUUID(),featureId=randomUUID(),ref=`refs/heads/maestro/feature/${featureId}/${workspaceId}`;
  const baseOid=(await repositories.git(checkout,['rev-parse','HEAD'])).trim();
  const request={workspaceId,featureId,ownedRoot,reference,adminDirectory:commonDirectory,commonDirectory,
    baseRef:'refs/heads/fixture-base',baseOid};
  return {repositories,checkout,root,request,ref,path:join(root,workspaceId),admin:join(common,'worktrees',workspaceId),
    deadline:()=>makeDeadline(systemClock,5000)};
}
