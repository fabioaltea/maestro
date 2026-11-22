import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {validateRequest} from '../../src/shared/validation.ts';
import {buildCliArgs} from '../../src/main/core-cli.ts';
import {workspaceCliInput} from '../../src/main/workspace-cli.ts';
import {validateWorkspaceData} from '../../src/shared/workspace-contract.ts';

test('workspace cleanup requires an exact target and uses stdin, with no renderer grant or force',()=>{
 const workspaceId=randomUUID(),targetRef='refs/heads/integration',targetOid='a'.repeat(40);
 const params={action:'remove',workspaceId,expectedStateRevision:'4',targetRef,targetOid};
 const request={bridgeVersion:1,callId:randomUUID(),selectionEpoch:1,params};
 validateRequest('prepareWorkspaceAction',request);
 for(const invalid of [{grantId:randomUUID()},{force:true},{targetOid:'HEAD'},{targetRef:'refs/remotes/origin/main'}])
   assert.throws(()=>validateRequest('prepareWorkspaceAction',{...request,params:{...params,...invalid}}));
 const command={namespace:'workspace' as const,action:'cleanup.prepare',archive:'/tmp/archive',params:{workspaceId,targetRef,targetOid}};
 const args=buildCliArgs(command);
 assert.deepEqual(args,['workspace','cleanup','prepare','--input-stdin','--state-dir=/tmp/archive','--json']);
 assert.deepEqual(JSON.parse(workspaceCliInput(command)!),command.params);
 assert.throws(()=>validateWorkspaceData('cleanup.get',{workspaceId,eligible:true,reason:null,checkedAt:new Date().toISOString(),evidence:null,freshness:'LAST_KNOWN'}));
});
