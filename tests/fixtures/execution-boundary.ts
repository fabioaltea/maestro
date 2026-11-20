import {createServer} from 'node:net';
import {mkdir,mkdtemp,realpath,rm,symlink,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createBoundaryFixture,compileBoundaryProbe,PINNED_CODEX,PINNED_HASH} from './discovery-boundary.js';
import type {TestContext} from 'node:test';

export {PINNED_CODEX,PINNED_HASH};
export const PINNED_CLAUDE='/Users/fabioaltea/.local/share/claude/versions/2.1.142';
export const PINNED_CLAUDE_HASH='772021afa051160b97e04d379738df84d4cacd311e8c199a325fb013b3eaa448';

export async function executionBoundaryFixture(t:TestContext){
 const f=await createBoundaryFixture();t.after(f.cleanup);
 const workspace=join(f.directory,'workspace'),other=join(f.directory,'other-workspace');
 const socketRoot=await realpath(await mkdtemp('/private/tmp/maestro-execution-probe-'));
 const socket=join(socketRoot,'endpoint');
 const server=createServer(client=>client.end());
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(socket,resolve);});
 t.after(async()=>{
   await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
   await rm(socketRoot,{recursive:true});
 });
 for(const path of [workspace,other])await mkdir(path,{mode:0o700});
 const target=join(workspace,'approved.txt'),outside=join(other,'unchanged.txt'),git=join(workspace,'.git'),escape=join(workspace,'escape');
 await writeFile(target,'authorized synthetic text',{mode:0o600});
 await writeFile(outside,'foreign synthetic text',{mode:0o600});
 await writeFile(git,'gitdir: never-touch',{mode:0o600});
 await symlink(f.secretPaths[0]!,escape);
 return{...f,workspace,other,target,outside,git,escape,socket,probe:await compileBoundaryProbe(f.directory)};
}
