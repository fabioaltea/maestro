import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {validateRequest} from '../../src/shared/validation.ts';
import {validateWorkspaceData} from '../../src/shared/workspace-contract.ts';
import {buildCliArgs,decodeResult} from '../../src/main/core-cli.ts';

test('workspace bridge accepts handoff IDs and bounds private scope and command arguments',()=>{
 const featureId=randomUUID(),envelopeId=randomUUID(),workspaceId=randomUUID(),projectId=randomUUID();
 const bridgeVersion=1,callId=randomUUID(),selectionEpoch=2,params={featureId,envelopeId};
 validateRequest('prepareWorkspaceAction',{bridgeVersion,callId,selectionEpoch,params});
 assert.throws(()=>validateRequest('prepareWorkspaceAction',{bridgeVersion,callId,selectionEpoch,params:{...params,argv:['git','reset']}}));
 assert.throws(()=>validateRequest('acquireWorkspaceLease',{bridgeVersion,callId,selectionEpoch,workspaceId}));
 const summary={workspaceId,featureId,projectId,envelopeId,featureRevision:'1',baseRef:'refs/heads/main',baseOid:'a'.repeat(40),
   branchRef:`refs/heads/maestro/feature/${featureId}/${workspaceId}`};
 const prepared={grantId:randomUUID(),canonicalIntentHash:'b'.repeat(64),expiresAtMs:Date.now()+60000,summary};
 assert.deepEqual(validateWorkspaceData('prepare',prepared),prepared);
 assert.throws(()=>validateWorkspaceData('prepare',{...prepared,summary:{...summary,ownedRoot:'/private'}}));
 const requestId=randomUUID(),cmd={namespace:'workspace' as const,action:'create',archive:'/var/state',requestId,params:{grantId:prepared.grantId}};
 assert.deepEqual(buildCliArgs(cmd),['workspace','create',`--grant=${prepared.grantId}`,`--request-id=${requestId}`,'--state-dir=/var/state','--json']);
 assert.throws(()=>buildCliArgs({...cmd,params:{...cmd.params,path:'/foo'}}));
 assert.throws(()=>decodeResult(JSON.stringify({protocolVersion:1,requestId:randomUUID(),storeId:randomUUID(),instanceId:randomUUID(),
   result:'OK',outcome:null,freshness:'LIVE',liveness:'LIVE_VERIFIED',data:{accepted:true,requestId,workspaceId,stateRevision:'1'},error:null}),cmd));
});
