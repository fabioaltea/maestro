import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {validateRequest} from '../../src/shared/validation.ts';
import {buildCliArgs,decodeResult} from '../../src/main/core-cli.ts';
import {featureCliInput} from '../../src/main/feature-cli.ts';
import {Confirmations} from '../../src/main/confirmations.ts';
const envelope=()=>({bridgeVersion:1,callId:randomUUID(),selectionEpoch:1});
test('feature named bridge rejects raw paths, credentials, approval and extra scopes',()=>{
 const p={action:'create',projectId:randomUUID(),expectedConfigRevision:'1',bundleArtifactId:randomUUID()};
 assert.doesNotThrow(()=>validateRequest('prepareFeatureAction',{...envelope(),params:p}));
 for(const extra of [{approved:true},{path:'/private/repo'},{command:'exec'},{apiKey:'SYNTHETIC'}])assert.throws(()=>validateRequest('prepareFeatureAction',{...envelope(),params:{...p,...extra}}));
 assert.throws(()=>validateRequest('chooseFeatureBundle',{...envelope(),path:'/private/input'}));
 assert.throws(()=>validateRequest('importFeatureBundle',{...envelope(),bundle:'x'.repeat(32768)}));
});
test('feature documents travel in stdin, grants stay in main and decoder rejects private data',()=>{
 const c={namespace:'feature' as const,action:'artifact.import',archive:'/owned/archive',requestId:randomUUID(),params:{bundle:'{"request":"<script>SYNTHETIC</script>"}'}};
 assert.ok(!JSON.stringify(buildCliArgs(c)).includes('SYNTHETIC'));assert.equal(featureCliInput(c),c.params.bundle);
 const read={namespace:'feature' as const,action:'get',archive:'/owned/archive',params:{featureId:randomUUID()}};
 const raw={protocolVersion:1,requestId:null,storeId:randomUUID(),instanceId:null,result:'OK',outcome:null,freshness:'LAST_KNOWN',liveness:'ABSENT_VERIFIED',data:{feature:null,freshness:'LAST_KNOWN'},error:null};
 assert.equal(decodeResult(JSON.stringify(raw),read).freshness,'LAST_KNOWN');
 for(const extra of [{canonicalIntent:'PRIVATE'},{grantId:randomUUID()},{stderr:'PRIVATE'},{approved:true}])assert.throws(()=>decodeResult(JSON.stringify({...raw,data:{...raw.data,...extra}}),read));
 const confirmations=new Confirmations(),scope={owner:1,frame:2,epoch:1,archiveHandle:randomUUID(),storeId:randomUUID()};
 const token=confirmations.prepare({...read,action:'archive',params:{grantId:randomUUID()}},scope,[]);assert.throws(()=>confirmations.consume(token.confirmationId,scope,['discovery']));
});
