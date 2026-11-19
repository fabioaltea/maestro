import {spawn} from 'node:child_process';
import {lstat,realpath,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {ArchivePaths} from '../../../ports/platform.js';
import type {Deadline} from '../../../ports/clock.js';
import type {EnvironmentInstallScope,EnvironmentJobIdentity,EnvironmentJobHostPort,EnvironmentValidationScope} from '../../../ports/environment.js';
import {environmentJobDirectories,readEnvironmentExit,sealJobEvidence} from './job-files.js';

const entry=fileURLToPath(new URL('./job-host-main.js',import.meta.url));
export function createEnvironmentJobHost(paths:ArchivePaths):EnvironmentJobHostPort{
 async function run(identity:EnvironmentJobIdentity,mode:'INSTALL'|'VALIDATE',
   scope:Omit<EnvironmentInstallScope,'store'|'scratch'>|Omit<EnvironmentValidationScope,'scratch'>,deadline:Deadline,signal:AbortSignal){
     const {proofRoot,scratch,store}=await environmentJobDirectories(paths,identity,true);
     if(await readEnvironmentExit(paths,identity))throw new Error('IDEMPOTENCY_CONFLICT');
     const node=await realpath(process.execPath);
     const input=JSON.stringify({identity,mode,proofRoot,scope:{...scope,store,scratch},timeoutMs:Math.min(300000,Math.floor(deadline.remainingMs()))});
     if(deadline.expired()||Buffer.byteLength(input)>32767)throw new Error('DEADLINE_EXCEEDED');
     await sealJobEvidence(proofRoot,'launch.json',identity);
     const child=spawn(node,[entry],{cwd:scratch.canonicalPath,shell:false,env:{PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C'},stdio:['pipe','ignore','ignore']});
     const abort=()=>{if(!child.stdin.destroyed)child.stdin.write('{"kind":"cancel"}\n');};
     const closed=new Promise<void>(resolve=>{
       child.once('error',()=>resolve());child.once('close',()=>resolve());
     });
     child.stdin.on('error',()=>{});
     try{
       child.stdin.write(input+'\n');
       signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
       await closed;
       return readEnvironmentExit(paths,identity);
     }finally{signal.removeEventListener('abort',abort);child.stdin.end();}
 }
 return{
   recover:identity=>readEnvironmentExit(paths,identity),
   install:(identity,scope,deadline,signal)=>run(identity,'INSTALL',scope,deadline,signal),
   validate:(identity,scope,deadline,signal)=>run(identity,'VALIDATE',scope,deadline,signal),
   async cleanup(identity){
     if(!await readEnvironmentExit(paths,identity))return;
     const {scratch}=await environmentJobDirectories(paths,identity,false),file=join(scratch.canonicalPath,'input.mjs');
     try{
       const info=await lstat(file);
       if(info.isFile()&&info.nlink===1&&info.uid===paths.ownerUid&&(info.mode&0o777)===0o400)await unlink(file);
     }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
   },
 };
}
