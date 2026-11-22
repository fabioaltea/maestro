import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {evaluateIntegrationRecovery,requireIntegrationCandidate,requireRefAttribution} from '../../src/domain/review/integration.js';

test('matching OIDs still need attributed CAS and guard sync evidence',()=>{
 const old='a'.repeat(40),candidate='b'.repeat(40),base={old,candidate};
 assert.equal(evaluateIntegrationRecovery({...base,observed:old,receipt:null}),'RECONCILING');
 assert.equal(evaluateIntegrationRecovery({...base,observed:candidate,receipt:{...base,guardSynced:true}}),'FINALIZE');
 assert.equal(evaluateIntegrationRecovery({...base,observed:candidate,receipt:{old:'c'.repeat(40),candidate,guardSynced:true}}),'RECONCILING');
 assert.equal(evaluateIntegrationRecovery({...base,observed:null,receipt:null}),'RECONCILING');
});

test('integration requires its own clean reservation, exact parent, candidate and evidence',()=>{
 const expected={targetOid:'a'.repeat(40),candidateOid:'b'.repeat(40),treeOid:'c'.repeat(40),
   reviewDigest:'a'.repeat(64),evidenceDigest:'b'.repeat(64),guardId:randomUUID(),stagingId:randomUUID()};
 const current={...expected,targetReserved:true,guardClean:true,stagingClean:true,conflict:false};
 assert.doesNotThrow(()=>requireIntegrationCandidate(expected,current));
 for(const [state,error] of [
   [{targetReserved:false},/TARGET_IN_USE/],
   [{targetOid:'f'.repeat(40)},/TARGET_MOVED/],
   [{conflict:true},/MERGE_CONFLICT/],
   [{guardClean:false},/INTEGRATION_UNKNOWN/],
   [{stagingClean:false},/CANDIDATE_CHANGED/],
   [{stagingId:randomUUID()},/CANDIDATE_CHANGED/],
   [{treeOid:'f'.repeat(40)},/CANDIDATE_CHANGED/],
   [{evidenceDigest:'f'.repeat(64)},/APPROVAL_STALE/],
   [{reviewDigest:'c'.repeat(64)},/APPROVAL_STALE/],
 ] as const)assert.throws(()=>requireIntegrationCandidate(expected,{...current,...state}),error);
});

test('only a ref proof attributed to the exact original request can authorize recovery',()=>{
 const expected={requestId:randomUUID(),old:'a'.repeat(40),candidate:'b'.repeat(40)};
 assert.throws(()=>requireRefAttribution(expected,{...expected,requestId:randomUUID()}),/INTEGRATION_UNKNOWN/);
 assert.throws(()=>requireRefAttribution(expected,{...expected,old:'c'.repeat(40)}),/INTEGRATION_UNKNOWN/);
 assert.throws(()=>requireRefAttribution(expected,null),/INTEGRATION_UNKNOWN/);
 const proof=requireRefAttribution(expected,expected);
 assert.equal(evaluateIntegrationRecovery({...expected,observed:expected.candidate,receipt:{...proof,guardSynced:false}}),'SYNC_GUARD');
 assert.equal(evaluateIntegrationRecovery({...expected,observed:expected.candidate,receipt:{...proof,guardSynced:true}}),'FINALIZE');
});
