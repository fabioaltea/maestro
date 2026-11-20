import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {workspaceRuntimeFixture} from './workspace-runtime.js';
import {makeDeadline,systemClock} from '../../src/ports/clock.js';

const run=promisify(execFile);
export async function reviewBoundaryFixture(t:Parameters<typeof workspaceRuntimeFixture>[0]){
 const f=await workspaceRuntimeFixture(t),created=await f.prepare();
 assert.equal((await f.submit(created.data.grantId)).operation?.outcome,'SUCCEEDED');
 const source=f.store.readWorkspaceState({kind:'get',id:created.data.summary.workspaceId}).workspace!;
 const cwd=source.ownership!.root.canonicalPath,relative='new-review-file.txt',targetRef='refs/heads/local-integration';
 async function git(path:string,args:readonly string[]){
   const result=await run('/usr/bin/git',['-c','core.hooksPath=/dev/null','-c','user.name=Maestro Fixture','-c',
     'user.email=fixture@example.invalid',...args],{cwd:path,env:{PATH:'/usr/bin:/bin',LANG:'C',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'},timeout:5000});
   return result.stdout.trim();
 }
 const targetOid=await git(cwd,['rev-parse','HEAD']);
 await git(cwd,['branch','local-integration',targetOid]);
 await writeFile(join(cwd,relative),'approved synthetic content\n',{mode:0o600});
 await git(cwd,['add','--',relative]);await git(cwd,['commit','-m','fixture candidate']);
 const sourceOid=await git(cwd,['rev-parse','HEAD']),guardId=randomUUID(),deadline=()=>makeDeadline(systemClock,12000);
 const scope={source:source.target,ownership:source.ownership!,targetRef,targetOid,sourceOid,guardId};
 return{...f,scope,source,cwd,relative,git,deadline,async guardContent(root:string){return readFile(join(root,relative),'utf8');}};
}
