import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {canonicalWorkflowIntent,validateWorkflowGrant} from '../../src/domain/workflow/authorization.js';

const domain='../../src/domain/review/integration.js';
test('review grants bind the exact target OID and replay only the consumed ID',()=>{
 const now=1800000000000,id=randomUUID(),intent={version:1,namespace:'REVIEW',action:'integrate',storeId:randomUUID(),ownerUid:501,
   targetId:randomUUID(),projectId:randomUUID(),expectedRevision:'2',configRevision:'1',payload:{targetOid:'a'.repeat(40)}};
 const canonical=canonicalWorkflowIntent(intent),grant={grantId:randomUUID(),canonicalIntent:canonical,createdAtMs:now,expiresAtMs:now+1000,consumedByRequestId:null};
 assert.equal(validateWorkflowGrant(grant,canonical,id,now),'CONSUME');
 assert.throws(()=>validateWorkflowGrant(grant,canonicalWorkflowIntent({...intent,payload:{targetOid:'b'.repeat(40)}}),id,now),/APPROVAL_REQUIRED/);
 assert.equal(validateWorkflowGrant({...grant,consumedByRequestId:id},canonical,id,now+1000),'REPLAY');
});

test('unknown target observations never prove integration',async()=>{
 const {evaluateIntegrationRecovery}=await import(domain),old='a'.repeat(40),candidate='b'.repeat(40);
 assert.equal(evaluateIntegrationRecovery({old,candidate,observed:old,receipt:null,noEffectVerified:true}),'NO_EFFECT');
 assert.equal(evaluateIntegrationRecovery({old,candidate,observed:candidate,receipt:null}),'RECONCILING');
 assert.equal(evaluateIntegrationRecovery({old,candidate,observed:candidate,receipt:{old,candidate,guardSynced:false}}),'SYNC_GUARD');
 assert.equal(evaluateIntegrationRecovery({old,candidate,observed:'c'.repeat(40),receipt:{old,candidate,guardSynced:true}}),'RECONCILING');
});
