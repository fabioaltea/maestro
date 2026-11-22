import {spawn} from 'node:child_process';
import {requireExecutionIdentity} from '../../../domain/execution/model.js';
import type {ExecutionExitProof,ExecutionIdentity} from '../../../ports/execution.js';
import type {ExecutionHost} from '../../../ports/execution-runtime.js';
import type {Deadline} from '../../../ports/clock.js';

import type {ExecutionInvocation} from './runtime.js';

export interface OwnedExecutionChild {
 readonly stdin:NodeJS.WritableStream;
 readonly stdout:AsyncIterable<Uint8Array>;
}
export function createOwnedExecutionHost(options:{
 identity:ExecutionIdentity;invocation:ExecutionInvocation;args:readonly string[];cwd:string;deadline:Deadline;
 consume(child:OwnedExecutionChild):Promise<{finalMessage:boolean}>;
 answer(interactionId:string,text:string):Promise<void>;
}):ExecutionHost{
 const {identity,invocation,deadline}=options;
 const completion=Promise.withResolvers<ExecutionExitProof>();
 let child:ReturnType<typeof spawn>|undefined,stopped=false,started=false,ended=false;
 let force:ReturnType<typeof setTimeout>|undefined,timer:ReturnType<typeof setTimeout>|undefined;
 function finish(code:number|null,finalMessage:boolean){
   if(ended)return;
   ended=true;clearTimeout(force);clearTimeout(timer);
   completion.resolve({identity,verified:true,code,finalMessage,interrupted:stopped});
 }
 function stop(){
   if(stopped)return;
   stopped=true;
   if(!child){finish(null,false);return;}
   child.stdin?.end();
   child.kill('SIGTERM');
   force=setTimeout(()=>{if(!ended)child?.kill('SIGKILL');},Math.min(1500,Math.max(1,deadline.remainingMs())));
 }
 return{
   ready:Promise.resolve(identity),
   exited:completion.promise,
   async go(received){
     requireExecutionIdentity(identity,received);
     if(started||stopped||ended||deadline.expired())throw new Error('STALE_TARGET');
     started=true;
     const process=spawn(invocation.executable,[...invocation.args,...options.args],{cwd:options.cwd,shell:false,
       env:{PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C'},stdio:['pipe','pipe','ignore']});
     child=process;
     process.stdin.on('error',()=>{});
     process.once('error',stop);
     timer=setTimeout(stop,Math.max(1,deadline.remainingMs()));
     const closed=new Promise<number|null>(resolve=>process.once('close',code=>resolve(code)));
     let result:Promise<{finalMessage:boolean}>;
     try{result=options.consume({stdin:process.stdin,stdout:process.stdout as AsyncIterable<Uint8Array>});}
     catch(error){result=Promise.reject(error);}
     void (async()=>{
       const [code,received]=await Promise.all([closed,result.catch(()=>{stop();return{finalMessage:false};})]);
       finish(code,received.finalMessage&&!stopped);
     })();
   },
   answer(id,text){
     if(!started||stopped||ended)return Promise.reject(new Error('STALE_TARGET'));
     return options.answer(id,text);
   },
   stop,
 };
}
