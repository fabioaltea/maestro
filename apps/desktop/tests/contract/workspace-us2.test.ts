import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {validateRequest} from '../../src/shared/validation.ts';
import {buildCliArgs} from '../../src/main/core-cli.ts';

test('workspace refresh crosses the bridge with its revision, with no holder or grant in renderer input',()=>{
 const workspaceId=randomUUID(),requestId=randomUUID(),params={action:'refresh',workspaceId,expectedStateRevision:'4'};
 const request={bridgeVersion:1,callId:randomUUID(),selectionEpoch:1,params};
 validateRequest('prepareWorkspaceAction',request);
 for(const invalid of [{holderId:randomUUID()},{grantId:randomUUID()},{expectedStateRevision:'0'}]){
   assert.throws(()=>validateRequest('prepareWorkspaceAction',{...request,params:{...params,...invalid}}));
 }
 assert.deepEqual(buildCliArgs({namespace:'workspace',action:'refresh',archive:'/tmp/archive',requestId,params:{workspaceId,expectedStateRevision:'4'}}),
   ['workspace','refresh','--expected-revision=4',`--request-id=${requestId}`,'--state-dir=/tmp/archive','--json','--',workspaceId]);
});
