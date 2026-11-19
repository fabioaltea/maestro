import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {featureDraft} from '../fixtures/feature-boundary.js';

const domain='../../src/domain/features/planning.js';

test('US3 validates closed results and rejects provenance outside the approved corpus and supplied answers',async()=>{
  const {validatePlanningResult}=await import(domain);
  const scope={sourceIds:['source-1'],answerIds:['answer-1']};
  const draft={kind:'DRAFT',bundle:{...featureDraft(),provenance:[{kind:'USER_CONFIRMED',text:'Scelta esplicita',sourceId:null,answerId:'answer-1'}]}};
  assert.deepEqual(validatePlanningResult(draft,scope),draft);
  assert.throws(()=>validatePlanningResult(draft,{...scope,answerIds:[]}),/PROVIDER_PROTOCOL_ERROR/);
  assert.throws(()=>validatePlanningResult({...draft,approved:true},scope),/PROVIDER_PROTOCOL_ERROR/);
  const q={questionId:'Q1',text:'Che cosa mostrare?',reason:'Ambito da definire'};
  assert.throws(()=>validatePlanningResult({kind:'QUESTIONS',questions:[q,q]},scope),/PROVIDER_PROTOCOL_ERROR/);
});

test('US3 binds a result to turn, generation, live state revision and authenticated exit',async()=>{
  const {requirePlanningExit,requirePlanningFence}=await import(domain);
  const identity={runId:randomUUID(),generation:randomUUID(),owningInstanceId:randomUUID()};
  const turn={...identity,featureId:randomUUID(),stateRevision:'2',revisionId:randomUUID(),phase:'RUNNING'};
  const feature={featureId:turn.featureId,stateRevision:'2',currentRevisionId:turn.revisionId,state:'PLANNING'};
  const proof={...identity,hostExited:true,providerExited:true};
  assert.doesNotThrow(()=>requirePlanningExit(identity,proof));
  assert.doesNotThrow(()=>requirePlanningFence(feature,turn,identity));
  for(const old of [{...proof,generation:randomUUID()},{...proof,owningInstanceId:randomUUID()},{...proof,providerExited:false},null]){
    assert.throws(()=>requirePlanningExit(identity,old),/RESOURCE_IDENTITY_UNKNOWN/);
  }
  for(const stale of [{...feature,stateRevision:'3'},{...feature,currentRevisionId:randomUUID()},{...feature,state:'RECONCILING'}]){
    assert.throws(()=>requirePlanningFence(stale,turn,identity),/STALE_TARGET/);
  }
});
