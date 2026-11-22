import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {validateFeatureParams} from '../../src/protocol/feature.js';
import {featureAuthoringFixture} from '../fixtures/feature-authoring.js';

test('US3 only admits explicit sealed context and answer references through closed prepare DTOs',()=>{
  const featureId=randomUUID(),expectedStateRevision='1',contextSnapshotId=randomUUID();
  const generate={action:'generate',featureId,expectedStateRevision,contextSnapshotId};
  assert.doesNotThrow(()=>validateFeatureParams('feature.prepare',generate));
  const answer={action:'answer',featureId,expectedStateRevision,turnId:randomUUID(),questionId:'Q1',answerArtifactId:randomUUID()};
  assert.doesNotThrow(()=>validateFeatureParams('feature.prepare',answer));
  for(const p of [{...generate,contextSnapshotId:undefined},{...generate,approved:true},{...generate,command:'synthetic'},
    {...answer,answerText:'body'},{...answer,answerArtifactId:undefined},{...answer,questionId:''}]){
    assert.throws(()=>validateFeatureParams('feature.prepare',p),/INVALID_REQUEST/);
  }
});

test('unqualified planning leaves live feature authoring available and creates no generation operation',async t=>{
  const f=await featureAuthoringFixture(t);
  assert.ok(f.runtime.methods.includes('feature.create'));
  for(const method of ['feature.generate','feature.answer','feature.cancel']){
    assert.ok(!f.runtime.methods.includes(method));
    const requestId=randomUUID();
    const r=await f.send(method,{requestId,grantId:randomUUID()});
    assert.equal((r.data as Record<string,unknown>).code,'UNSUPPORTED_VERSION');
    assert.equal(f.store.readFeatureState({kind:'operation',id:requestId}).operation,null);
  }
  const p=await f.send('feature.prepare',{action:'generate',featureId:randomUUID(),expectedStateRevision:'1',contextSnapshotId:f.discovery().snapshotId});
  assert.equal((p.data as Record<string,unknown>).code,'PLANNING_UNAVAILABLE');
});
