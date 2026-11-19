import {spawn} from 'node:child_process';
import {realpath} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import type {ArchivePaths} from '../../../ports/platform.js';
import type {EnvironmentJobHostPort} from '../../../ports/environment.js';
import {environmentJobDirectories,readEnvironmentExit,sealJobEvidence} from './job-files.js';

const entry=fileURLToPath(new URL('./job-host-main.js',import.meta.url));
export function createEnvironmentJobHost(paths:ArchivePaths):EnvironmentJobHostPort{
 return{
   recover:identity=>readEnvironmentExit(paths,identity),
   async install(identity,scope,deadline,signal){
     const {proofRoot,scratch,store}=await environmentJobDirectories(paths,identity,true);
     if(await readEnvironmentExit(paths,identity))throw new Error('IDEMPOTENCY_CONFLICT');
     const node=await realpath(process.execPath);
     const input=JSON.stringify({identity,proofRoot,scope:{...scope,store,scratch},timeoutMs:Math.min(300000,Math.floor(deadline.remainingMs()))});
     if(deadline.expired()||input.length>32767)throw new Error('DEADLINE_EXCEEDED');
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
   },
 };
}
