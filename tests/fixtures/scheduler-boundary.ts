import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';

export function schedulerBoundaryFixture(){
 const projects=[randomUUID(),randomUUID()];
 const workspaces=Array.from({length:5},()=>randomUUID());
 let wall=1_800_000_000_000,monotonic=0;
 function clock(){return{wallUtc:()=>new Date(wall).toISOString(),monotonicNow:()=>monotonic};}
 function move(ms:number){wall+=ms;monotonic+=Math.max(ms,0);}
 function job(project:number,type:'DISCOVERY'|'EXECUTION'|'INSTALL'|'VALIDATE',workspace:number){
   return{jobId:randomUUID(),generation:randomUUID(),projectId:projects[project]!,type,workspaceId:workspaces[workspace]!};
 }
 async function spawnLocal(){
   const child=spawn('/usr/bin/true',[],{shell:false,stdio:'ignore',env:{PATH:'/usr/bin:/bin',LANG:'C'}});
   await new Promise<void>((resolve,reject)=>{
     child.once('error',reject);
     child.once('close',(code,signal)=>code===0&&signal===null?resolve():reject(new Error('fixture process did not exit cleanly')));
   });
 }
 return{job,clock,move,spawnLocal};
}
