import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {validateRequest} from '../../src/shared/validation.ts';
import {buildCliArgs} from '../../src/main/core-cli.ts';
import {environmentCliInput} from '../../src/main/environment-cli.ts';

test('environment bridge uses typed planning and sends attestation text only via stdin',()=>{
 const workspaceId=randomUUID(),callId=randomUUID(),inputDigest='a'.repeat(64);
 const p={bridgeVersion:1,callId,selectionEpoch:3,params:{action:'attest',stateRevision:'2',workspaceId,inputDigest,limitations:['Verifica locale']}};
 validateRequest('prepareEnvironmentAction',p);
 for(const extra of [{grantId:randomUUID()},{command:'npm install'},{path:'/tmp'}])
   assert.throws(()=>validateRequest('prepareEnvironmentAction',{...p,params:{...p.params,...extra}}));
 const command={namespace:'environment' as const,action:'authorize',archive:'/tmp/state',params:{
   action:'attest',intent:{workspaceId,inputDigest,limitations:p.params.limitations},expectedRevisions:{stateRevision:'2'},
 }};
 assert.deepEqual(buildCliArgs(command),['environment','prepare','--input-stdin','--state-dir=/tmp/state','--json']);
 assert.deepEqual(JSON.parse(environmentCliInput(command)!),command.params);
});
