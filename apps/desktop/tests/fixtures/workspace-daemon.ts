import {randomUUID} from 'node:crypto';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {repositoryRoot} from './desktop.ts';

const archive=process.argv[2];
if(archive){
 const {runControl}=await import(join(repositoryRoot,'dist/core/control-main.js'));
 const {createDaemonLauncher}=await import(join(repositoryRoot,'dist/platform/macos/launcher.js'));
 process.exitCode=await runControl({protocolVersion:1,action:'start',requestId:randomUUID(),canonicalStateDir:archive},
   {launcher:createDaemonLauncher({daemonFile:fileURLToPath(import.meta.url)})});
}else{
 const {runDaemon}=await import(join(repositoryRoot,'dist/core/daemon-main.js'));
 const {readBootstrap}=await import(join(repositoryRoot,'dist/core/entrypoint.js'));
 const {createOwnedWorkspaceFiles}=await import(join(repositoryRoot,'dist/platform/macos/git/workspace-files.js'));
 const intent=await readBootstrap();
 if(!/\/maestro-desktop-[A-Za-z0-9]+\/archive$/.test(intent.canonicalStateDir))throw new Error('UNOWNED_FIXTURE');
 await runDaemon(intent,{workspaceFiles:createOwnedWorkspaceFiles(join(dirname(intent.canonicalStateDir),'owned-workspaces'))});
}
