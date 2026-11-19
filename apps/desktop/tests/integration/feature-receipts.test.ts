import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {writeFile} from 'node:fs/promises';
import {createScratch} from '../fixtures/desktop.ts';
import {ArchiveContext} from '../../src/main/archive-context.ts';
import {ReceiptStore} from '../../src/main/receipt-store.ts';
import {ActionService} from '../../src/main/action-handlers.ts';
import {FeatureActions} from '../../src/main/feature.ts';
import {OperationRecovery} from '../../src/main/operation-recovery.ts';
import type {CliCommand} from '../../src/main/ports.ts';
import type {PublicResult} from '../../src/shared/bridge-contract.ts';
test('feature persists original target receipt before send and lost reply recovers without a repeated action',async()=>{
 const f=await createScratch();try{
 const context=new ArchiveContext();await context.select(f.archive);const receipts=new ReceiptStore(join(f.directory,'receipts')),storeId=randomUUID(),featureId=randomUUID(),projectId=randomUUID(),calls:CliCommand[]=[];
 const base=(c:CliCommand):PublicResult=>({protocolVersion:1,requestId:c.requestId??null,storeId,instanceId:randomUUID(),result:'OK',outcome:null,freshness:'LIVE',liveness:'LIVE_VERIFIED',error:null,data:{}});
 const core={async call(c:CliCommand):Promise<PublicResult>{calls.push(c);const r=base(c);if(c.namespace==='daemon')return{...r,data:{lifecycle:'RUNNING',capabilities:{featureVersion:1,featureMethods:['feature.create','feature.prepare']}}};
 if(c.action==='prepare')return{...r,data:{grantId:randomUUID(),expiresAtMs:Date.now()+300000,canonicalIntent:JSON.stringify({action:'create',targetId:featureId,projectId,storeId,payload:{bundleArtifactId:c.params?.bundleArtifactId}}),summary:{}}};
 if(c.action==='operation'){const requestId=String(c.params?.requestId);return{...r,requestId,outcome:'SUCCEEDED',data:{operation:{requestId,namespace:'FEATURE',action:'create',targetId:featureId,phase:'FINALIZED',outcome:'SUCCEEDED',acceptedAt:new Date().toISOString(),completedAt:new Date().toISOString(),result:{featureId},error:null}}};}
 const saved=(await receipts.list())[0]!;assert.equal(saved.requestId,c.requestId);assert.equal(saved.featureId,featureId);assert.ok(!JSON.stringify(saved).includes('grantId'));throw new Error('LOST_REPLY');},close(){}};
 const owner=()=>({owner:7,frame:4}),service=new ActionService({context,receipts,core,owner}),actions=new FeatureActions({context,core,dialogs:{async chooseDirectory(){return null;}},owner});service.resolveFeature=(a,p)=>actions.resolve(a,p);
 const prepared=await service.prepare('feature.create',{projectId,expectedConfigRevision:'1',bundleArtifactId:randomUUID()}),sent=await service.confirm(prepared.confirmationId,['feature']);assert.equal(sent.receipt.phase,'UNKNOWN');const recovery=new OperationRecovery(receipts,core),final=await recovery.reconcile(prepared.requestId);assert.equal(final.receipt.phase,'TERMINAL');assert.equal(calls.filter(c=>c.action==='create').length,1);assert.equal(calls.at(-1)!.params?.requestId,prepared.requestId);
 }finally{await f.cleanup();}
});
test('feature bundle picker handles are bound to owner and archive epoch; renderer never supplies a file path',async()=>{
 const f=await createScratch();try{const context=new ArchiveContext();await context.select(f.archive);const path=join(f.directory,'bundle.json');await writeFile(path,'{}');let frame=4;
 const actions=new FeatureActions({context,core:{async call(){throw new Error('UNEXPECTED');},close(){}},dialogs:{async chooseDirectory(){return null;},async chooseFile(){return path;}},owner:()=>({owner:7,frame})});const chosen=await actions.chooseBundle();assert.ok(chosen);assert.ok(!JSON.stringify(chosen).includes(f.directory));frame++;await assert.rejects(()=>actions.resolve('feature.artifact.import',{bundleHandle:chosen.bundleHandle}),/STALE_CONTEXT/);
 frame--;const next=await actions.chooseBundle();await context.select(join(f.directory,'other'));await assert.rejects(()=>actions.resolve('feature.artifact.import',{bundleHandle:next!.bundleHandle}),/STALE_CONTEXT/);
 }finally{await f.cleanup();}
});
test('desktop serializes its two bounded readonly requests so quiescent leases do not contend offline',async()=>{
 const {CoreCli}=await import('../../src/main/core-cli.ts'),{validateRuntime}=await import('../../src/main/runtime.ts'),{repositoryRoot}=await import('../fixtures/desktop.ts');
 const f=await createScratch();try{await f.cli(['daemon','start']);const repo=await f.repository();await f.cli(['project','add',repo.path]);await f.cli(['daemon','stop']);const core=new CoreCli(await validateRuntime(process.execPath,join(repositoryRoot,'dist/cli/main.js')));try{const results=await Promise.all([core.call({namespace:'daemon',action:'status',archive:f.archive}),core.call({namespace:'project',action:'list',archive:f.archive,params:{limit:25}})]);for(const r of results)assert.equal(r.result,'OK',JSON.stringify(r));assert.equal((results[1]!.data.projects as unknown[]).length,1);}finally{core.close();}}finally{await f.cleanup();}
});
