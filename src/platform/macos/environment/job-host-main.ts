import {createPnpmEnvironment} from './pnpm.js';
import {checkEnvironmentDisk,sealJobEvidence} from './job-files.js';
import {makeDeadline,systemClock} from '../../../ports/clock.js';
import {foundationError,type ErrorCode} from '../../../domain/errors.js';
import {requireUuid} from '../../../domain/identifiers.js';
import type {EnvironmentExitEvidence,EnvironmentInstallScope,EnvironmentJobIdentity} from '../../../ports/environment.js';

interface Start {readonly identity:EnvironmentJobIdentity;readonly scope:EnvironmentInstallScope;readonly timeoutMs:number;
 readonly proofRoot:EnvironmentInstallScope['scratch']}
const abort=new AbortController();
let running=false,pending=Buffer.alloc(0),budgetError:string|null=null;
const cancel=()=>abort.abort();
process.on('SIGTERM',cancel);
process.stdin.on('end',cancel);
process.stdin.on('error',cancel);

function safeCode(error:unknown):string{
 try{return foundationError((error as Error).message as ErrorCode).code;}catch{return 'INSTALL_FAILED';}
}
async function execute(input:Start){
 const {identity,scope,timeoutMs}=input;
 requireUuid(identity.jobId);requireUuid(identity.generation);requireUuid(identity.leaseId);
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>300000)throw new Error('INVALID_REQUEST');
 const deadline=makeDeadline(systemClock,timeoutMs);
 let proof:EnvironmentExitEvidence;
 let timer:ReturnType<typeof setTimeout>|undefined,sample:Promise<void>|undefined,finished=false;
 function monitor(){
   if(finished)return;
   sample=checkEnvironmentDisk(scope,deadline).catch(error=>{
     budgetError=safeCode(error);cancel();
   }).finally(()=>{if(!finished&&!abort.signal.aborted)timer=setTimeout(monitor,750);});
 }
 try{
   await checkEnvironmentDisk(scope,deadline);
   timer=setTimeout(monitor,750);
   const result=await createPnpmEnvironment().install(scope,deadline,abort.signal);
   finished=true;clearTimeout(timer);await sample;
   if(result.outcome==='RECONCILING'||!result.exitVerified)throw new Error('JOB_RECONCILING');
   if(budgetError)throw new Error(budgetError);
   if(result.outcome==='SUCCEEDED')await checkEnvironmentDisk(scope,deadline);
   proof={...identity,verified:true,exitCode:result.exitCode,outcome:result.outcome,error:result.error,...(result.error==='OUTPUT_LIMIT'?{truncated:true}:{})};
 }catch(error){
   const code=safeCode(error);
   if(code==='JOB_RECONCILING')throw error;
   proof={...identity,verified:true,exitCode:null,outcome:'FAILED',error:code};
 }finally{finished=true;clearTimeout(timer);await sample;}
 await sealJobEvidence(input.proofRoot,'exit.json',proof);
}
process.stdin.on('data',(chunk:Buffer)=>{
 pending=Buffer.concat([pending,chunk]);
 if(pending.length>32768){cancel();process.stdin.destroy();if(!running)process.exitCode=7;return;}
 for(let newline=pending.indexOf(10);newline>=0;newline=pending.indexOf(10)){
   const line=pending.subarray(0,newline);pending=pending.subarray(newline+1);
   try{
     const body=JSON.parse(line.toString('utf8')) as Start|{kind:string};
     if(running){if('kind' in body&&body.kind==='cancel')cancel();else throw new Error('INVALID_REQUEST');}
     else{
       if('kind' in body)throw new Error('INVALID_REQUEST');
       running=true;
       void execute(body).catch(()=>{process.exitCode=7;}).finally(()=>{
         process.stdin.destroy();
         process.off('SIGTERM',cancel);
       });
     }
   }catch{cancel();process.stdin.destroy();if(!running)process.exitCode=7;return;}
 }
});
