import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {validateRequest} from '../../src/shared/validation.ts';
import {buildCliArgs,decodeResult} from '../../src/main/core-cli.ts';
import {featureCliInput} from '../../src/main/feature-cli.ts';
import {validateReceipt} from '../../src/main/receipt-store.ts';

const bridge=()=>({bridgeVersion:1,callId:randomUUID(),selectionEpoch:1});

test('approval and handoff prepare are revision-bound named calls, with accepted unknowns sent via stdin',()=>{
  const featureId=randomUUID(),revisionId=randomUUID(),storeId=randomUUID();
  const scope={featureId,revisionId,expectedStateRevision:'2'};
  const approve={action:'approve',...scope,acceptedUnknownIds:['incognita sintetica']};
  const handoff={action:'handoff',...scope};
  for(const params of [approve,handoff]){
    assert.doesNotThrow(()=>validateRequest('prepareFeatureAction',{...bridge(),params}));
    for(const extra of [{grantId:randomUUID()},{command:'SYNTHETIC'},{approved:true},{checkId:randomUUID()}]){
      assert.throws(()=>validateRequest('prepareFeatureAction',{...bridge(),params:{...params,...extra}}));
    }
    const requestId=randomUUID(),now=new Date().toISOString();
    assert.doesNotThrow(()=>validateReceipt({requestId,namespace:'feature',action:params.action,archivePath:'/own/archive',storeId,featureId,projectId:randomUUID(),
      expectedRevision:'2',intentHash:'a'.repeat(64),receiptVersion:1,createdAt:now,updatedAt:now,phase:'PREPARED',outcome:null,errorCode:null}));
  }
  assert.throws(()=>validateRequest('prepareFeatureAction',{...bridge(),params:{...approve,acceptedUnknownIds:['x','x']}}));
  const command={namespace:'feature' as const,action:'prepare',archive:'/own/archive',params:approve};
  assert.ok(!buildCliArgs(command).join(' ').includes('incognita sintetica'));
  assert.deepEqual(JSON.parse(featureCliInput(command)!),approve);
});

test('historical handoff metadata is allowed while cross-target and offline eligibility are rejected',()=>{
  const featureId=randomUUID(),checkId=randomUUID(),storeId=randomUUID(),envelopeId=randomUUID();
  const command={namespace:'feature' as const,action:'eligibility',archive:'/own/archive',params:{featureId,checkId}};
  assert.doesNotThrow(()=>validateRequest('getFeatureEligibility',{...bridge(),...command.params}));
  assert.ok(buildCliArgs(command).includes(`--check-id=${checkId}`));
  const data={featureId,checkId,eligible:true,reason:null,checkedAt:new Date().toISOString(),freshness:'CURRENT'};
  const response={protocolVersion:1,requestId:null,storeId,instanceId:randomUUID(),result:'OK',outcome:null,freshness:'LIVE',liveness:'LIVE_VERIFIED',data,error:null};
  assert.equal(decodeResult(JSON.stringify(response),command).data.eligible,true);
  assert.throws(()=>decodeResult(JSON.stringify({...response,freshness:'LAST_KNOWN',liveness:'ABSENT_VERIFIED'}),command));
  assert.throws(()=>decodeResult(JSON.stringify({...response,data:{...data,checkId:randomUUID()}}),command));
  const read={...command,action:'envelope',params:{envelopeId}};
  const envelope={envelopeId,featureId,digest:'f'.repeat(64)};
  const archived={...response,instanceId:null,liveness:'ABSENT_VERIFIED',freshness:'LAST_KNOWN',data:{envelope}};
  assert.deepEqual(decodeResult(JSON.stringify(archived),read).data.envelope,envelope);
  assert.throws(()=>decodeResult(JSON.stringify({...archived,data:{envelope:{...envelope,grantId:randomUUID()}}}),read));
});
