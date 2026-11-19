import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {writeFile} from 'node:fs/promises';
import {featureAuthoringFixture} from '../fixtures/feature-authoring.js';
import {featureDraft} from '../fixtures/feature-boundary.js';
async function create(f:Awaited<ReturnType<typeof featureAuthoringFixture>>){const artifactId=await f.upload(featureDraft()),g=await f.prepareFeature('create',{projectId:f.projectId,expectedConfigRevision:'1',bundleArtifactId:artifactId}),r=await f.execute('create',g.grantId as string);assert.equal(r.operation!.outcome,'SUCCEEDED');return r.operation!.result!;}
test('US2 exact approval and immutable handoff survive reply loss; revision or context changes deny new handoff and preserve history',async t=>{
 const f=await featureAuthoringFixture(t,{loseApprovalReply:true}),c=await create(f),featureId=c.featureId as string,revisionId=c.revisionId as string;
 const pre=await f.prepareFeature('approve',{featureId,revisionId,expectedStateRevision:'1',acceptedUnknownIds:[]}),approved=await f.execute('approve',pre.grantId as string);assert.equal(approved.operation!.outcome,'SUCCEEDED');const approvalId=approved.operation!.result!.approvalId;
 const replay=await f.execute('approve',pre.grantId as string,approved.requestId);assert.deepEqual(replay.operation,approved.operation);
 const hg=await f.prepareFeature('handoff',{featureId,revisionId,expectedStateRevision:'2'}),handoff=await f.execute('handoff',hg.grantId as string);assert.equal(handoff.operation!.outcome,'SUCCEEDED');const envelope=f.store.readFeatureState({kind:'envelope',id:handoff.operation!.result!.envelopeId as string}).envelope!;assert.equal(envelope.approvalId,approvalId);assert.equal(envelope.projectId,f.projectId);assert.equal(envelope.bundleDigest,f.store.readFeatureState({kind:'revision',id:revisionId}).revision!.bundleDigest);
 const stale=await f.prepareFeature('handoff',{featureId,revisionId,expectedStateRevision:'2'});await writeFile(join(f.repo,'tracked.txt'),'context changed after consent');const failed=await f.execute('handoff',stale.grantId as string);assert.equal(failed.operation!.outcome,'FAILED');assert.equal(f.store.readFeatureState({kind:'approval',id:revisionId}).approval!.approvalId,approvalId);assert.deepEqual(f.store.readFeatureState({kind:'envelope',id:envelope.envelopeId}).envelope,envelope);assert.equal(f.store.readFeatureState({kind:'feature',id:featureId}).feature!.state,'NEEDS_REVIEW');
});
test('US2 competing revision consumes a new version and invalidates a previously prepared approval',async t=>{
 const f=await featureAuthoringFixture(t),c=await create(f),featureId=c.featureId as string,revisionId=c.revisionId as string;
 const approve=await f.prepareFeature('approve',{featureId,revisionId,expectedStateRevision:'1',acceptedUnknownIds:[]}),bundle=featureDraft();bundle.request='revised request';const artifactId=await f.upload(bundle),g=await f.prepareFeature('revise',{featureId,expectedStateRevision:'1',bundleArtifactId:artifactId});assert.equal((await f.execute('revise',g.grantId as string)).operation!.outcome,'SUCCEEDED');assert.equal((await f.execute('approve',approve.grantId as string)).operation!.outcome,'FAILED');assert.equal(f.store.readFeatureState({kind:'approval',id:revisionId}).approval,null);
});
