import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {createRegistryStore} from '../fixtures/registry-store.js';
import {openStorage} from '../../src/storage/worker.js';
import {createPlatformPaths} from '../../src/platform/macos/paths.js';
import {makeDeadline,systemClock} from '../../src/ports/clock.js';
import {createFeatureRuntime} from '../../src/core/features/runtime.js';
import {canonicalWorkflowIntent} from '../../src/domain/workflow/authorization.js';
import type {AuthenticatedPeer} from '../../src/ports/platform.js';
const peer:AuthenticatedPeer={role:'client',identity:'fixture',credentialId:'fixture'};
async function fixture(t:Parameters<typeof createRegistryStore>[0]){const f=await createRegistryStore(t);f.store.close();const storage=await openStorage({path:f.path});t.after(()=>storage.close());const paths=(await createPlatformPaths().resolveArchive(f.directory,'read'))!;const runtime=createFeatureRuntime(storage,paths,f.instanceId);return{...f,storage,runtime};}
test('feature runtime fences admission until recovery and on shutdown, but retains bounded historical reads',async t=>{
 const f=await fixture(t),body=Buffer.from('runtime input'),requestId=randomUUID(),params={requestId,kind:'INPUT',expectedBytes:body.length,sha256:createHash('sha256').update(body).digest('hex')};
 const dispatch=async(method:string,p:Record<string,unknown>,role=peer)=>f.runtime.dispatch({protocolVersion:1,correlationId:randomUUID(),method,params:p},role,(await f.storage.readSnapshot())!);
 assert.equal((await dispatch('feature.artifact.reserve',params)).result,'BLOCKED');await f.runtime.recover();
 assert.ok(f.runtime.methods.includes('feature.artifact.reserve'));assert.ok(!f.runtime.methods.includes('feature.generate'));
 assert.equal((await dispatch('feature.artifact.reserve',params)).result,'OK');
 assert.equal((await dispatch('feature.artifact.budget',{}, {...peer,role:'controller'})).result,'ERROR');
 f.runtime.fence();assert.equal((await dispatch('feature.artifact.reserve',{...params,requestId:randomUUID()})).result,'BLOCKED');
 assert.equal((await dispatch('feature.operation.get',{requestId})).result,'OK');await f.runtime.stop(makeDeadline(systemClock,1000));
});
test('restart reconciles original local intents without replay or deleting partial artifacts',async t=>{
 const f=await fixture(t),requestId=randomUUID();const canonicalIntent=canonicalWorkflowIntent({version:1,storeId:f.storeId,ownerUid:process.getuid!(),namespace:'ARTIFACT',action:'reserve',targetId:null,projectId:null,expectedRevision:null,configRevision:null,payload:{kind:'INPUT',expectedBytes:1,sha256:'a'.repeat(64),targetId:null}});
 await f.storage.commitFeatureState!({kind:'admit',admission:{requestId,grantId:null,canonicalIntent,instanceId:f.instanceId,nowMs:Date.now()}});
 await f.runtime.recover();assert.equal((await f.storage.readFeatureState!({kind:'operation',id:requestId})).operation!.outcome,'INTERRUPTED');
 const result=await f.runtime.dispatch({protocolVersion:1,correlationId:randomUUID(),method:'feature.operation.get',params:{requestId}},peer,(await f.storage.readSnapshot())!);assert.equal((result.data as {operation:{outcome:string}}).operation.outcome,'INTERRUPTED');
});
test('actual daemon composes only installed feature capabilities and the same client can read offline after stop',async t=>{
 const {createCliHarness}=await import('../fixtures/cli-harness.js');const {LocalClient}=await import('../../src/client/local-client.js');const {createClientBackend}=await import('../../src/bootstrap.js');
 const h=await createCliHarness(t),started=await h.call('start');assert.equal(started.code,0,started.stdout);
 const status=JSON.parse((await h.call('status')).stdout) as {data:{capabilities:{featureVersion:number;featureMethods:string[]}}};
 assert.equal(status.data.capabilities.featureVersion,1);assert.ok(status.data.capabilities.featureMethods.includes('feature.artifact.reserve'));assert.ok(!status.data.capabilities.featureMethods.includes('feature.generate'));
 const client=new LocalClient(createClientBackend()),live=await client.runFeature('feature.provider.get',{}, {stateDirectory:h.archive});assert.equal(live.result,'OK');assert.equal((live.data.capabilities as {qualified:boolean}).qualified,false);
 assert.equal((await h.call('stop')).code,0);
 const offline=await client.runFeature('feature.provider.get',{}, {stateDirectory:h.archive});assert.equal(offline.result,'OK');assert.equal(offline.freshness,'LAST_KNOWN');
});
