import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {lstat,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {environmentRuntimeFixture} from '../fixtures/environment-runtime.js';
import {startSuccessor} from '../fixtures/workspace-runtime.js';
import {createEnvironmentInstallation} from '../../src/core/environments/prepare.js';
import {createEnvironmentInspector} from '../../src/platform/macos/environment/inspect.js';
import {createEnvironmentJobHost} from '../../src/platform/macos/environment/job-host.js';
import {createWorkspaceLeases} from '../../src/core/workspaces/leases.js';

type Fixture=Awaited<ReturnType<typeof environmentRuntimeFixture>>;
const literal='; $(literal) & |';
async function ready(f:Fixture){
 const commands=['normal','error','timeout','overflow'].map(name=>({id:randomUUID(),entry:name+'.mjs',argv:[literal],timeoutMs:name==='timeout'?2500:10000}));
 const plan=await f.plan(async(path,manifest)=>{
   manifest.maestro={validation:commands};
   await writeFile(join(path,'normal.mjs'),`import {get} from 'node:http'; import {writeFileSync} from 'node:fs'; import {spawnSync} from 'node:child_process';
const child=spawnSync(process.execPath,['--version']);
if (!child.error || !['EPERM','EACCES'].includes(child.error.code)) process.exit(4);
try {writeFileSync('unexpected','bad');process.exit(3)} catch (e){if(!['EPERM','EACCES'].includes(e.code))process.exit(5);}
const denied=await new Promise(resolve=>get(${JSON.stringify(f.g0.registry.origin)},()=>resolve(false))
  .on('error',error=>resolve(['EPERM','EACCES'].includes(error.code))));
process.exit(denied&&process.argv[2]===${JSON.stringify(literal)}?0:2);`);
   await writeFile(join(path,'error.mjs'),"console.log('private output'); process.exit(14);");
   await writeFile(join(path,'timeout.mjs'),'setInterval(()=>{},1000);');
   await writeFile(join(path,'overflow.mjs'),"process.stdout.write('x'.repeat(70000));");
 });
 const install=await f.send('environment.prepare',{grantId:plan.grantId,requestId:randomUUID()});
 assert.equal(install.result,'OK',JSON.stringify(install));await f.runtime.idle();
 assert.equal(environment().state,'READY');
 function environment(){return f.store.readEnvironmentState({kind:'workspace',id:plan.workspaceId}).environment!;}
 async function authorize(commandSpecId:string,inputDigest=plan.prepared.inputDigest){
   return f.send('environment.prepare',{action:'validate',intent:{environmentId:environment().environmentId,commandSpecId,inputDigest},
     expectedRevisions:{stateRevision:environment().stateRevision}});
 }
 return{...plan,commands,environment,authorize};
}
const value=(r:{data:unknown})=>r.data as {grantId:string;code:string;chunks:{artifactId:string}[]};
test('approved validation runs exact argv, permits no workspace writes, and distinguishes exit, timeout, stale input and retry',async t=>{
 const f=await environmentRuntimeFixture(t),r=await ready(f);
 assert.equal(value(await r.authorize(randomUUID())).code,'INVALID_REQUEST');
 assert.equal(value(await f.send('environment.validate',{grantId:r.grantId,requestId:randomUUID()})).code,'APPROVAL_REQUIRED');
 for(const [index,phase,code,error] of [[0,'SUCCEEDED',0,null],[1,'FAILED',14,'VALIDATION_FAILED'],[2,'FAILED',null,'DEADLINE_EXCEEDED'],[3,'FAILED',null,'OUTPUT_LIMIT']] as const){
   const approval=await r.authorize(r.commands[index]!.id);assert.equal(approval.result,'OK',JSON.stringify(approval));
   const requestId=randomUUID(),grantId=value(approval).grantId;
   const job=await f.send('environment.validate',{grantId,requestId});assert.equal(job.result,'OK',JSON.stringify(job));
   await f.runtime.idle();
   const result=f.store.readEnvironmentState({kind:'job',id:requestId}).job!;
   assert.equal(result.phase,phase,JSON.stringify(result));if(index!==3)assert.equal(result.exitProof?.code,code);assert.equal(result.safeError,error);
   assert.equal(result.truncated,index===3);
   const page=await f.send('environment.output.list',{jobId:requestId});
   const artifact=await f.send('environment.artifact.get',{artifactId:value(page).chunks[0]!.artifactId});
   const text=Buffer.from((artifact.data as {base64:string}).base64,'base64').toString('utf8');
   assert.ok(!text.includes('private output'));
   assert.equal(JSON.parse(text).commandSpecId,r.commands[index]!.id);
   assert.equal(result.inputDigest,r.prepared.inputDigest);assert.equal(result.outputWatermark,'1');
   await assert.rejects(lstat(join(f.paths.directory,'environment-data','jobs',`${result.jobId}.${result.generation}`,'run','input.mjs')),{code:'ENOENT'});
   const reply=await f.send('environment.validate',{grantId,requestId});assert.ok((reply.data as {operation:unknown}).operation);
   assert.equal(r.environment().state,'READY');
 }
 await assert.rejects(lstat(join(r.path,'unexpected')), {code:'ENOENT'});
 await writeFile(join(r.path,'normal.mjs'),'process.exit(0)');
 assert.equal(value(await r.authorize(r.commands[0]!.id)).code,'ENVIRONMENT_STALE');
 assert.equal(r.environment().state,'STALE');
});

test('successor retains an uncertain validation and explicitly reconciles the original sealed output',async t=>{
 let finishes=0,visible=false;
 const scheduled:Promise<void>[]=[];
 const f=await environmentRuntimeFixture(t,false,host=>({...host,async validate(...args){
   finishes++;
   assert.ok(await host.validate(...args));return null;
 }})),r=await ready(f);
 const approval=await r.authorize(r.commands[0]!.id);assert.equal(approval.result,'OK',JSON.stringify(approval));
 const requestId=randomUUID(),grantId=value(approval).grantId;
 assert.equal((await f.send('environment.validate',{grantId,requestId})).result,'OK');await f.runtime.idle();
 assert.equal(r.environment().state,'RECONCILING');
 assert.ok(f.store.readWorkspaceState({kind:'active-lease',id:r.workspaceId}).lease);
 const instanceId=startSuccessor(f);
 const leases=createWorkspaceLeases({storage:f.storage,instanceId,files:f.files,mutator:f.mutator,accepting:()=>true});
 await leases.recover();
 const host=createEnvironmentJobHost(f.paths),recovery=createEnvironmentInstallation({
   storage:f.storage,paths:f.paths,instanceId,owned:leases.owned,inspector:createEnvironmentInspector(),
   lease:leases.forConsumer('ENVIRONMENT'),host:{...host,recover:identity=>visible?host.recover(identity):Promise.resolve(null)},
   accepting:()=>true,schedule:observe=>scheduled.push(observe())
 });
 await recovery.recover();assert.equal(scheduled.length,0);
 const job=f.store.readEnvironmentState({kind:'job',id:requestId}).job!;
 assert.equal(job.phase,'RECONCILING');assert.equal(finishes,1);
 f.store.transitionInstance(instanceId,'RUNNING');visible=true;
 const params={jobId:requestId,expectedStateRevision:job.stateRevision,requestId:randomUUID()};
 const reply=await recovery.actions['environment.reconcile'](params,f.peer);
 assert.equal(reply.accepted,true,JSON.stringify(reply));
 await Promise.all(scheduled);
 const reconciled=await recovery.actions['environment.reconcile'](params,f.peer);
 assert.equal((reconciled.operation as {outcome:string}).outcome,'SUCCEEDED',JSON.stringify(reconciled));
 assert.deepEqual(await recovery.actions['environment.reconcile'](params,f.peer),reconciled);
 assert.equal(f.store.readFeatureState({kind:'operation',id:requestId}).operation?.outcome,'SUCCEEDED');
 const recovered=f.store.readEnvironmentState({kind:'job',id:requestId}).job!;
 assert.equal(recovered.outputWatermark,'1');assert.equal(recovered.inputDigest,r.prepared.inputDigest);
 assert.equal(recovered.exitProof?.verified,true);assert.equal(finishes,1);
 await assert.rejects(lstat(join(f.paths.directory,'environment-data','jobs',`${recovered.jobId}.${recovered.generation}`,'run','input.mjs')),{code:'ENOENT'});
 assert.equal(f.store.readWorkspaceState({kind:'active-lease',id:r.workspaceId}).lease,null);
});


test('crash before validation launch settles the original UUID and competing admission cannot start',async t=>{
 let hold=false,launches=0;
 const f=await environmentRuntimeFixture(t,false,host=>({...host,async validate(...args){launches++;return host.validate(...args);}}),()=>hold);
 const r=await ready(f),requestId=randomUUID();
 const a=await r.authorize(r.commands[0]!.id),b=await r.authorize(r.commands[1]!.id);
 assert.equal(a.result,'OK');assert.equal(b.result,'OK');hold=true;
 const params={grantId:value(a).grantId,requestId};
 assert.equal((await f.send('environment.validate',params)).result,'OK');
 const duplicate=await f.send('environment.validate',params);
 assert.equal((duplicate.data as {operation:{outcome:string}}).operation.outcome,'IN_PROGRESS');
 assert.equal(value(await f.send('environment.validate',{grantId:value(b).grantId,requestId})).code,'IDEMPOTENCY_CONFLICT');
 assert.notEqual((await f.send('environment.validate',{grantId:value(b).grantId,requestId:randomUUID()})).result,'OK');
 assert.equal(f.store.readEnvironmentState({kind:'job',id:requestId}).job?.phase,'QUEUED');
 const instanceId=startSuccessor(f);
 const leases=createWorkspaceLeases({storage:f.storage,instanceId,files:f.files,mutator:f.mutator,accepting:()=>true});
 await leases.recover();
 const recovery=createEnvironmentInstallation({storage:f.storage,paths:f.paths,instanceId,owned:leases.owned,inspector:createEnvironmentInspector(),
   lease:leases.forConsumer('ENVIRONMENT'),host:createEnvironmentJobHost(f.paths),accepting:()=>true,schedule:()=>assert.fail('recovery cannot launch')});
 await recovery.recover();
 assert.equal(f.store.readEnvironmentState({kind:'job',id:requestId}).job?.exitProof,null);
 assert.equal(f.store.readFeatureState({kind:'operation',id:requestId}).operation?.outcome,'INTERRUPTED');
 assert.equal(f.store.readWorkspaceState({kind:'active-lease',id:r.workspaceId}).lease,null);
 assert.equal(r.environment().state,'READY');
 assert.equal(launches,0);
});
