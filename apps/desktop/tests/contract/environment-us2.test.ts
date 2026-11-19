import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {validateRequest} from '../../src/shared/validation.ts';
import {validateEnvironmentData} from '../../src/shared/environment-contract.ts';
import {buildCliArgs} from '../../src/main/core-cli.ts';
import {blocksMutation} from '../../src/main/confirmations.ts';

test('desktop allows only reviewed install and cancel and reads scoped output',()=>{
 const workspaceId=randomUUID(),jobId=randomUUID(),grantId=randomUUID(),requestId=randomUUID();
 const base={bridgeVersion:1,callId:randomUUID(),selectionEpoch:3};
 validateRequest('prepareEnvironmentAction',{...base,params:{action:'prepare',workspaceId,stateRevision:'1',planId:randomUUID(),planDigest:'f'.repeat(64)}});
 validateRequest('prepareEnvironmentAction',{...base,params:{action:'cancel',workspaceId,stateRevision:'1',jobId}});
 assert.throws(()=>validateRequest('prepareEnvironmentAction',{...base,params:{action:'cancel',workspaceId,stateRevision:'1',jobId,pid:123}}));
 validateRequest('getEnvironmentOutput',{...base,jobId,limit:1});
 assert.throws(()=>validateRequest('getEnvironmentOutput',{...base,jobId,limit:21}));
 assert.throws(()=>validateEnvironmentData('output',{jobId,chunks:[],watermark:'1',truncated:false,rawStderr:'private'}));
 const archive='/tmp/state';
 for(const action of ['prepare','cancel'])assert.deepEqual(buildCliArgs({namespace:'environment',action,archive,requestId,params:{grantId}}),
   ['environment',action,`--grant=${grantId}`,`--request-id=${requestId}`,`--state-dir=${archive}`,'--json']);
 const pending=[{archivePath:archive,namespace:'environment',action:'prepare',projectId:workspaceId,phase:'PENDING',outcome:null}];
 assert.equal(blocksMutation(pending,archive,'environment','cancel',workspaceId),false);
 assert.equal(blocksMutation(pending,archive,'environment','prepare',workspaceId),true);
});
