import assert from 'node:assert/strict';
import test from 'node:test';
import {evaluateIntegrationRecovery} from '../../src/domain/review/integration.js';

test('matching OIDs still need attributed CAS and guard sync evidence',()=>{
 const old='a'.repeat(40),candidate='b'.repeat(40),base={old,candidate};
 assert.equal(evaluateIntegrationRecovery({...base,observed:old,receipt:null}),'RECONCILING');
 assert.equal(evaluateIntegrationRecovery({...base,observed:candidate,receipt:{...base,guardSynced:true}}),'FINALIZE');
 assert.equal(evaluateIntegrationRecovery({...base,observed:candidate,receipt:{old:'c'.repeat(40),candidate,guardSynced:true}}),'RECONCILING');
 assert.equal(evaluateIntegrationRecovery({...base,observed:null,receipt:null}),'RECONCILING');
});
