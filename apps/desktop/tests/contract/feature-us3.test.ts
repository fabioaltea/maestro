import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {validateRequest} from '../../src/shared/validation.ts';
import {buildCliArgs,decodeResult} from '../../src/main/core-cli.ts';
import {featureCliInput} from '../../src/main/feature-cli.ts';

const bridge=()=>({bridgeVersion:1,callId:randomUUID(),selectionEpoch:1});

test('assisted calls require scoped snapshot and answer artifact without renderer-supplied authority',()=>{
  const featureId=randomUUID(),turnId=randomUUID(),answerArtifactId=randomUUID(),contextSnapshotId=randomUUID();
  const scope={featureId,expectedStateRevision:'2'};
  const answer={action:'answer',...scope,turnId,questionId:'Q1',answerArtifactId};
  for(const params of [answer,{action:'generate',...scope,contextSnapshotId},{action:'cancel',...scope}]){
    assert.doesNotThrow(()=>validateRequest('prepareFeatureAction',{...bridge(),params}));
    assert.throws(()=>validateRequest('prepareFeatureAction',{...bridge(),params:{...params,grantId:randomUUID()}}));
    assert.throws(()=>validateRequest('prepareFeatureAction',{...bridge(),params:{...params,processId:123}}));
  }
  assert.throws(()=>validateRequest('prepareFeatureAction',{...bridge(),params:{...answer,answerText:'Private answer'}}));
  const params={featureId,answerText:'Solo testo <script>inerte</script>'};
  assert.doesNotThrow(()=>validateRequest('importFeatureAnswer',{...bridge(),...params}));
  assert.throws(()=>validateRequest('importFeatureAnswer',{...bridge(),...params,answerText:'é'.repeat(2049)}));
  const command={namespace:'feature' as const,action:'artifact.import-answer',archive:'/own/archive',requestId:randomUUID(),params};
  assert.ok(buildCliArgs(command).includes('--answer-stdin'));
  assert.ok(!buildCliArgs(command).join(' ').includes(params.answerText));
  assert.equal(JSON.parse(featureCliInput(command)!),params.answerText);
});

test('assisted turn decoder rejects other turns and any private runtime identity',()=>{
  const turnId=randomUUID(),featureId=randomUUID();
  const command={namespace:'feature' as const,action:'planning',archive:'/own/archive',params:{turnId}};
  const turn={turnId,featureId,phase:'WAITING_USER',questionIds:['Q1'],turnIndex:1};
  const result={protocolVersion:1,requestId:null,storeId:randomUUID(),instanceId:randomUUID(),result:'OK',outcome:null,
    freshness:'LIVE',liveness:'LIVE_VERIFIED',data:{turn},error:null};
  assert.deepEqual(decodeResult(JSON.stringify(result),command).data.turn,turn);
  for(const extra of [{turnId:randomUUID()},{owningInstanceId:randomUUID()},{hostEndpoint:'/private/socket'},{password:'SYNTHETIC'}]){
    assert.throws(()=>decodeResult(JSON.stringify({...result,data:{turn:{...turn,...extra}}}),command));
  }
});
