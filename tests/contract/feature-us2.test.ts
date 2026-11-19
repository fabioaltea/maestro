import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {validateFeatureParams} from '../../src/protocol/feature.js';
import {featureAuthoringFixture} from '../fixtures/feature-authoring.js';
import {featureDraft} from '../fixtures/feature-boundary.js';
test('US2 prepare binds revision and accepted unknowns; handoff cannot accept a forged runtime grant',async t=>{
 const featureId=randomUUID(),revisionId=randomUUID(),p={action:'approve',featureId,expectedStateRevision:'1',revisionId,acceptedUnknownIds:[]};assert.doesNotThrow(()=>validateFeatureParams('feature.prepare',p));
 for(const extra of [{approved:true},{checkId:randomUUID()},{startRuntime:true},{acceptedUnknownIds:['x','x']}])assert.throws(()=>validateFeatureParams('feature.prepare',{...p,...extra}));
 assert.throws(()=>validateFeatureParams('feature.handoff',{requestId:randomUUID(),grantId:randomUUID(),command:'exec'}));
 const f=await featureAuthoringFixture(t),artifactId=await f.upload(featureDraft()),g=await f.prepareFeature('create',{projectId:f.projectId,expectedConfigRevision:'1',bundleArtifactId:artifactId}),c=await f.execute('create',g.grantId as string);const id=c.operation!.result!.featureId;
 const r=await f.send('feature.prepare',{action:'approve',featureId:id,expectedStateRevision:'1',revisionId:c.operation!.result!.revisionId,acceptedUnknownIds:[]});assert.equal(r.result,'OK',JSON.stringify(r));
 const wrong=await f.send('feature.handoff',{requestId:randomUUID(),grantId:(r.data as Record<string,unknown>).grantId});assert.equal((wrong.data as Record<string,unknown>).code,'APPROVAL_REQUIRED');
});
