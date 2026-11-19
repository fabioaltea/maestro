import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {featureAuthoringFixture} from '../fixtures/feature-authoring.js';
import {featureDraft} from '../fixtures/feature-boundary.js';
import {createPlatformPaths} from '../../src/platform/macos/paths.js';
import {createLocalTransport} from '../../src/platform/macos/transport.js';
import {invokeCli} from '../fixtures/cli-harness.js';
test('feature CLI imports, authors, approves and releases a handoff with original UUIDs and offline history',async t=>{
 const f=await featureAuthoringFixture(t),key=await createPlatformPaths().createCredential(f.paths.clientKeyFile);
 const server=await createLocalTransport().listen(f.paths.daemonEndpoint,f.instanceId,new Map([[key,'client']]),async(request,peer)=>request.method==='status.get'?{protocolVersion:1,correlationId:request.correlationId,result:'OK',data:{storeId:f.storeId,instanceId:f.instanceId,lifecycle:'RUNNING',capabilities:{featureVersion:1,featureMethods:f.runtime.methods}}}:f.runtime.dispatch(request,peer,f.store.readSnapshot()!));
 const call=async(...args:string[])=>{const r=await invokeCli(['feature',...args,'--state-dir',f.directory,'--json']);assert.ok(Buffer.byteLength(r.stdout)<32768);return JSON.parse(r.stdout);};
 try{
 const bundle=featureDraft();bundle.request='x'.repeat(12000);const path=join(f.directory,'bundle.json');await writeFile(path,JSON.stringify(bundle));const root=randomUUID();
 const uploaded=await call('artifact','import',`--bundle-file=${path}`,`--request-id=${root}`);assert.equal(uploaded.result,'OK',JSON.stringify(uploaded));assert.equal(uploaded.data.operation.outcome,'SUCCEEDED');
 const artifactId=uploaded.data.operation.result.artifactId;assert.ok(artifactId);
 const revision=f.store.readSnapshot()!.store.revision;assert.deepEqual(await call('artifact','import',`--bundle-file=${path}`,`--request-id=${root}`),uploaded);assert.equal(f.store.readSnapshot()!.store.revision,revision);
 const input=join(f.directory,'input.json');await writeFile(input,JSON.stringify({action:'create',projectId:f.projectId,expectedConfigRevision:'1',bundleArtifactId:artifactId}));
 const prepared=await call('prepare',`--input-file=${input}`);assert.equal(prepared.result,'OK',JSON.stringify(prepared));const requestId=randomUUID();const created=await call('create',`--grant=${prepared.data.grantId}`,`--request-id=${requestId}`);assert.equal(created.data.accepted,true,JSON.stringify(created));await f.runtime.idle();
 const op=await call('operation',requestId);assert.equal(op.data.operation.outcome,'SUCCEEDED');const {featureId,revisionId}=op.data.operation.result;
 assert.equal((await call('show',featureId)).data.feature.currentRevisionId,revisionId);
 assert.equal((await call('list',f.projectId)).data.items.length,1);
 assert.equal((await call('show',featureId,'--grant',randomUUID())).error.code,'INVALID_REQUEST');
 async function prepare(action:string,expectedStateRevision:string){
   await writeFile(input,JSON.stringify({action,featureId,expectedStateRevision,revisionId,...(action==='approve'?{acceptedUnknownIds:[]}: {})}));
   const r=await call('prepare',`--input-file=${input}`);assert.equal(r.result,'OK',JSON.stringify(r));return r.data.grantId as string;
 }
 const approveGrant=await prepare('approve','1'),approvalRequest=randomUUID();
 assert.equal((await call('handoff',`--grant=${approveGrant}`,`--request-id=${randomUUID()}`)).error.code,'APPROVAL_REQUIRED');
 assert.equal((await call('approve',`--grant=${approveGrant}`,`--request-id=${approvalRequest}`)).requestId,approvalRequest);
 await f.runtime.idle();
 const approved=await call('operation',approvalRequest);
 assert.equal(approved.data.operation.outcome,'SUCCEEDED',JSON.stringify(approved));
 assert.equal((await call('approval',revisionId)).data.approval.approvalId,approved.data.operation.result.approvalId);
 const eligibility=await call('eligibility',featureId);assert.equal(eligibility.data.reason,'CHECKING',JSON.stringify(eligibility));
 await f.runtime.idle();
 assert.equal((await call('eligibility',featureId,`--check-id=${eligibility.data.checkId}`)).data.eligible,true);
 const handoffGrant=await prepare('handoff','2'),handoffRequest=randomUUID();
 const handoffArgs=['handoff',`--grant=${handoffGrant}`,`--request-id=${handoffRequest}`];
 assert.equal((await call(...handoffArgs)).requestId,handoffRequest);
 await f.runtime.idle();
 const handedOff=await call('operation',handoffRequest);
 assert.equal(handedOff.data.operation.outcome,'SUCCEEDED',JSON.stringify(handedOff));
 assert.deepEqual((await call(...handoffArgs)).data.operation,handedOff.data.operation);
 const envelopeId=handedOff.data.operation.result.envelopeId;
 assert.equal((await call('envelope',envelopeId)).data.envelope.revisionId,revisionId);
 assert.equal((await call('approval',revisionId,'--check-id',randomUUID())).error.code,'INVALID_REQUEST');
 await server.close();
 assert.equal((await call('show',featureId)).freshness,'LAST_KNOWN');
 assert.equal((await call('operation',requestId)).data.operation.outcome,'SUCCEEDED');
 assert.equal((await call('envelope',envelopeId)).freshness,'LAST_KNOWN');
 const offlineEligibility=await call('eligibility',featureId);
 assert.equal(offlineEligibility.data.eligible,false);
 assert.equal(offlineEligibility.freshness,'LAST_KNOWN');
 }finally{await server.close();}
});
