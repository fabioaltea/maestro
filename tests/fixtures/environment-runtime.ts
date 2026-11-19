import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {startSuccessor,workspaceRuntimeFixture} from '../fixtures/workspace-runtime.js';
import {environmentBoundaryFixture} from './environment-boundary.js';
import {createEnvironmentRuntime} from '../../src/core/environments/runtime.js';
import {createEnvironmentPlanning} from '../../src/core/environments/plan.js';
import {createWorkspaceLeases,verifyOwnedWorktree} from '../../src/core/workspaces/leases.js';
import {createEnvironmentInspector} from '../../src/platform/macos/environment/inspect.js';
import {createEnvironmentJobHost} from '../../src/platform/macos/environment/job-host.js';
import {createEnvironmentInstallation} from '../../src/core/environments/prepare.js';

import type {EnvironmentJobHostPort} from '../../src/ports/environment.js';

export async function environmentRuntimeFixture(t:Parameters<typeof workspaceRuntimeFixture>[0],hold=false,customize?:(host:EnvironmentJobHostPort)=>EnvironmentJobHostPort){
 const g0=await environmentBoundaryFixture(t,hold),seed=await g0.workspace('seed');
 const f=await workspaceRuntimeFixture(t),owned=(workspace:Parameters<typeof verifyOwnedWorktree>[2])=>verifyOwnedWorktree(f,f.storeId,workspace);
 const leases=createWorkspaceLeases({storage:f.storage,instanceId:f.instanceId,files:f.files,mutator:f.mutator,accepting:()=>true}).forConsumer('ENVIRONMENT');
 const runtime=createEnvironmentRuntime({storage:f.storage,instanceId:f.instanceId,compose:context=>{
   const options={...context,storage:f.storage,instanceId:f.instanceId,paths:f.paths,inspector:createEnvironmentInspector(),owned};
   const host=createEnvironmentJobHost(f.paths);
   const planning=createEnvironmentPlanning(options),installation=createEnvironmentInstallation({...options,lease:leases,
     host:customize?.(host)??host});
   const authorize=planning.actions['environment.prepare'];
   return{...installation,actions:{...planning.actions,...installation.actions,
     'environment.prepare':(p,peer)=>p.action==='attest'?authorize(p,peer):installation.actions['environment.prepare'](p,peer)}};
 }});
 await runtime.recover();
 const send=(method:string,params:Record<string,unknown>)=>runtime.dispatch({method,params,correlationId:randomUUID(),protocolVersion:1},f.peer,f.store.readSnapshot()!);
 async function plan(configure?:(path:string,manifest:Record<string,unknown>)=>Promise<void>){
   const ready=await f.prepare();assert.equal((await f.submit(ready.data.grantId)).operation?.outcome,'SUCCEEDED');
   const workspaceId=ready.data.summary.workspaceId,workspace=f.store.readWorkspaceState({kind:'get',id:workspaceId}).workspace!;
   const path=workspace.ownership!.root.canonicalPath;
   const manifest=JSON.parse(await readFile(seed.manifestPath,'utf8'));delete manifest.scripts;
   await configure?.(path,manifest);
   await writeFile(join(path,'package.json'),JSON.stringify(manifest));await writeFile(join(path,'pnpm-lock.yaml'),await readFile(seed.lockPath));
   const started=await send('environment.plan',{requestId:randomUUID(),workspaceId,expectedStateRevision:workspace.stateRevision});
   assert.equal(started.result,'OK',JSON.stringify(started));await runtime.idle();
   const environment=f.store.readEnvironmentState({kind:'workspace',id:workspaceId}).environment!;
   assert.equal(environment.state,'PLANNED');
   const prepared=f.store.readEnvironmentState({kind:'plan',id:environment.currentPlanId!}).plan!;
   const approval=await send('environment.prepare',{action:'prepare',intent:{planId:prepared.planId,planDigest:prepared.digest},
     expectedRevisions:{stateRevision:environment.stateRevision}});
   assert.equal(approval.result,'OK',JSON.stringify(approval));
   return{workspaceId,path,prepared,grantId:(approval.data as {grantId:string}).grantId};
 }
 return{...f,g0,runtime,send,plan};
}
