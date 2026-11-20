import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {chmod,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as wait} from 'node:timers/promises';
import type {TestContext} from 'node:test';
import {makeDeadline,systemClock} from '../../src/ports/clock.js';
import type {ExecutionExitProof,ExecutionIdentity} from '../../src/ports/execution.js';
import type {ExecutionRuntimePort} from '../../src/ports/execution-runtime.js';
import type {DiscoveryEligibility} from '../../src/domain/discovery/approval.js';
import {createExecutionRuntime} from '../../src/core/execution/runtime.js';
import {createProfileRuntime} from '../../src/core/profiles/runtime.js';
import {composeProfileServices} from '../../src/core/profiles/registry.js';
import {createWorkspaceLeases,verifyOwnedWorktree} from '../../src/core/workspaces/leases.js';
import {createEnvironmentRuntime} from '../../src/core/environments/runtime.js';
import {createEnvironmentPlanning} from '../../src/core/environments/plan.js';
import {createEnvironmentInspector} from '../../src/platform/macos/environment/inspect.js';
import {createExecutionCommandProfile,runExecutionQualificationProbe} from '../../src/platform/macos/execution/runtime.js';
import {workspaceRuntimeFixture} from './workspace-runtime.js';
import {compileBoundaryProbe} from './discovery-boundary.js';

const hash=(data:Uint8Array)=>createHash('sha256').update(data).digest('hex');
export async function executionRuntimeFixture(t:TestContext,options:{question?:boolean;output?:string;unknownExit?:boolean;beforeGo?:()=>void}={}){
 const f=await workspaceRuntimeFixture(t),created=await f.prepare(),workspaceId=created.data.summary.workspaceId;
 assert.equal((await f.submit(created.data.grantId)).operation?.outcome,'SUCCEEDED');
 const workspace=f.store.readWorkspaceState({kind:'get',id:workspaceId}).workspace!,path=workspace.ownership!.root.canonicalPath;
 await chmod(path,0o700);
 const target=join(path,'approved.txt');
 await writeFile(target,'fixture original',{mode:0o600});
 const probe=await compileBoundaryProbe(f.repositories.directory);
 const owned=(worktree:typeof workspace)=>verifyOwnedWorktree(f,f.storeId,worktree);
 const eligibility=(peer:typeof f.peer,projectId:string)=>f.service.currentEligibility(peer,projectId) as Promise<DiscoveryEligibility>;
 const call=(runtime:{dispatch:typeof f.runtime.dispatch},method:string,params:Record<string,unknown>)=>
   runtime.dispatch({protocolVersion:1,correlationId:randomUUID(),method,params},f.peer,f.store.readSnapshot()!);
 async function ok(runtime:Parameters<typeof call>[0],method:string,params:Record<string,unknown>){
   const r=await call(runtime,method,params);
   assert.ok(r.result==='OK'||r.result==='BUSY',JSON.stringify(r));
   return r.data as Record<string,unknown>;
 }
 const env=createEnvironmentRuntime({storage:f.storage,instanceId:f.instanceId,compose:context=>createEnvironmentPlanning({
   ...context,storage:f.storage,paths:f.paths,instanceId:f.instanceId,inspector:createEnvironmentInspector(),owned,
 })});
 await env.recover();
 await writeFile(join(path,'package.json'),JSON.stringify({name:'fixture',packageManager:'npm@11.20.0'}));
 await writeFile(join(path,'package-lock.json'),'{"lockfileVersion":3}\n');
 await ok(env,'environment.plan',{requestId:randomUUID(),workspaceId,expectedStateRevision:workspace.stateRevision});await env.idle();
 const state=f.store.readEnvironmentState({kind:'workspace',id:workspaceId}).environment!;
 assert.equal(state.state,'MANUAL_REQUIRED');
 const plan=f.store.readEnvironmentState({kind:'plan',id:state.currentPlanId!}).plan!;
 const attestation=await ok(env,'environment.prepare',{action:'attest',
   intent:{workspaceId,inputDigest:plan.inputDigest,limitations:['Fixture locale']},expectedRevisions:{stateRevision:state.stateRevision}});
 await ok(env,'environment.attest',{requestId:randomUUID(),grantId:attestation.grantId});
 const profile=createProfileRuntime({storage:f.storage,paths:f.paths,instanceId:f.instanceId,compose:context=>{
   const layer={allow:['WORKSPACE_READ','WORKSPACE_WRITE'] as const,deny:[]};
   return composeProfileServices(context,{runtime:layer,project:layer});
 }});
 profile.start();
 const capabilities=await ok(profile,'profile.capabilities',{}),providerCapabilityDigest=(capabilities.capability as {digest:string}).digest;
 const records=await ok(profile,'profile.list',{kind:'PROFILE'}),role=(records.items as {alias:string;entityId:string;revisionId:string}[]).find(x=>x.alias==='backend')!;
 const profileResolutionId=randomUUID();
 await ok(profile,'profile.resolve',{requestId:profileResolutionId,profileId:role.entityId,revisionId:role.revisionId,projectId:f.projectId,providerCapabilityDigest});
 let opens=0,writes=0;
 const receivedAnswers:string[]=[];
 const processProofs=new Map<string,ExecutionExitProof>();
 const host:ExecutionRuntimePort={
   async input({workspace}){await owned(workspace);return{treeDigest:hash(await readFile(target)),profileBytes:7,bytes:Buffer.from('fixture input')};},
   async checkpoint(workspace){await owned(workspace);const patch=await readFile(target);return{treeDigest:hash(patch),patch};},
   async observe(identity){return processProofs.get(identity.runId)??null;},
   async open({identity,output,question,permissions}){
     assert.deepEqual(permissions,['WORKSPACE_READ','WORKSPACE_WRITE']);
     opens++;
     const invocation=await createExecutionCommandProfile({executable:probe,workspace:path,target});
     let stopped=false,done=false,active:Promise<void>|undefined,interactionId:string|undefined;
     const exit=Promise.withResolvers<ExecutionExitProof>();
     function finish(finalMessage:boolean,code:number|null){
       if(done)return;
       done=true;
       if(options.unknownExit){exit.reject(new Error('PROCESS_UNKNOWN'));return;}
       const ended:ExecutionExitProof={identity,verified:true,code,finalMessage,interrupted:stopped};
       processProofs.set(identity.runId,ended);exit.resolve(ended);
     }
     return{
       ready:Promise.resolve(identity),
       exited:exit.promise,
       async go(received:ExecutionIdentity){
         assert.deepEqual(received,identity);
         assert.equal(f.store.readExecutionState({kind:'run',id:identity.runId}).run?.phase,'RUNNING');
         if(stopped)throw new Error('INTERRUPTED');
         options.beforeGo?.();
         active=(async()=>{
           const command=await runExecutionQualificationProbe(invocation,['write',target],path);
           if(command.code!==10)throw new Error('PROVIDER_UNSAFE');
           writes++;
           if(stopped)return;
           await output(options.output??'Testo sintetico');
           if(options.question)interactionId=await question('Confermi il passaggio seguente?');
           else finish(true,0);
         })();
         try{await active;}finally{if(stopped)finish(false,null);}
       },
       async answer(id,text){
         if(stopped||id!==interactionId)throw new Error('STALE_TARGET');
         receivedAnswers.push(text);finish(true,0);
       },
       stop(){
         stopped=true;
         if(active)void active.catch(()=>{}).then(()=>finish(false,null));
         else finish(false,null);
       },
     };
   },
 };
 const lease=createWorkspaceLeases({storage:f.storage,instanceId:f.instanceId,files:f.files,mutator:f.mutator,accepting:()=>true}).forConsumer('RUN');
 const runtime=createExecutionRuntime({storage:f.storage,paths:f.paths,instanceId:f.instanceId,currentEligibility:eligibility,lease,
   dependencies:{host,provider:{async check(){return{status:'QUALIFIED',capabilityDigest:providerCapabilityDigest,error:null};}}}});
 await runtime.recover();
 t.after(()=>runtime.stop(makeDeadline(systemClock,4000)));
 const send=(action:string,p:Record<string,unknown>)=>call(runtime,`execution.${action}`,p);
 const prepare=async(action:string,intent:Record<string,unknown>,expectedRevisions:Record<string,unknown>={})=>
   (await ok(runtime,'execution.prepare',{action,intent,expectedRevisions})).grantId as string;
 const mutate=async(action:string,grantId:string,requestId=randomUUID())=>{
   const reply=await send(action,{grantId,requestId});
   return{reply,requestId,operation:f.store.readFeatureState({kind:'operation',id:requestId}).operation};
 };
 const grant=await prepare('provider.configure',{providerId:'codex',binaryHandle:randomUUID(),authProfileRef:randomUUID(),modelId:'fixture'},{configRevision:null});
 assert.equal((await mutate('provider.configure',grant)).operation?.outcome,'SUCCEEDED');
 await ok(runtime,'execution.provider.check',{requestId:randomUUID(),providerId:'codex',expectedConfigRevision:'1'});
 const startIntent={featureId:created.feature.featureId,profileResolutionId,workspaceId,envelopeId:created.feature.envelope.envelopeId};
 return{...f,runtime,host,send,prepare,mutate,target,startIntent,receivedAnswers,role,profile,
   counts:()=>({opens,writes}),state:(id:string)=>f.store.readExecutionState({kind:'session',id}).session,
   run:(id:string)=>f.store.readExecutionState({kind:'run',id}).run};
}

export async function waitForExecution(check:()=>boolean){
 for(let attempts=0;attempts<200;attempts++){if(check())return;await wait(25);}
 assert.fail('stato execution atteso assente');
}

