import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {validateRequest} from '../../src/shared/validation.ts';
import {validateEnvironmentData} from '../../src/shared/environment-contract.ts';
import {buildCliArgs} from '../../src/main/core-cli.ts';
import {blocksMutation} from '../../src/main/confirmations.ts';

test('desktop validation exposes only manifest checks and reconciliation of a revision-bound job',()=>{
 const workspaceId=randomUUID(),jobId=randomUUID(),environmentId=randomUUID(),commandSpecId=randomUUID();
 const call={bridgeVersion:1,callId:randomUUID(),selectionEpoch:3};
 const validate={action:'validate',workspaceId,environmentId,commandSpecId,inputDigest:'d'.repeat(64),stateRevision:'3'};
 validateRequest('prepareEnvironmentAction',{...call,params:validate});
 for(const extra of [{argv:['--eval']},{entry:'/tmp/any.mjs'},{grantId:randomUUID()}])
   assert.throws(()=>validateRequest('prepareEnvironmentAction',{...call,params:{...validate,...extra}}));
 const reconcile={action:'reconcile',workspaceId,jobId,stateRevision:'2'};
 validateRequest('prepareEnvironmentAction',{...call,params:reconcile});
 assert.throws(()=>validateRequest('prepareEnvironmentAction',{...call,params:{...reconcile,generation:randomUUID()}}));
 const archive='/tmp/state',requestId=randomUUID();
 assert.deepEqual(buildCliArgs({namespace:'environment',action:'reconcile',archive,requestId,params:{jobId,expectedStateRevision:'2'}}),
   ['environment','reconcile','--expected-revision=2',`--request-id=${requestId}`,`--state-dir=${archive}`,'--json','--',jobId]);
 const summary={...validate,entry:'check.mjs',argCount:0,timeoutMs:3000,networkScope:'OFFLINE',writePolicy:'DENIED'};
 const approval={grantId:randomUUID(),expiresAtMs:1000,canonicalIntentHash:'a'.repeat(64),summary};
 assert.deepEqual(validateEnvironmentData('authorize',approval),approval);
 assert.throws(()=>validateEnvironmentData('authorize',{...approval,summary:{...summary,entry:'../other.mjs'}}));
 const receipts=[{archivePath:archive,namespace:'environment',action:'validate',projectId:workspaceId,phase:'UNKNOWN',outcome:null}];
 assert.equal(blocksMutation(receipts,archive,'environment','reconcile',workspaceId),false);
 assert.equal(blocksMutation(receipts,archive,'environment','validate',workspaceId),true);
});
