import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {validateRequest} from '../../src/shared/validation.ts';
import {buildCliArgs} from '../../src/main/core-cli.ts';
import {executionCliInput} from '../../src/main/execution-cli.ts';
import {validateExecutionData} from '../../src/shared/execution-contract.ts';

test('execution bridge requires closed approval DTOs and carries selectors on stdin',()=>{
 const id=randomUUID(),request={bridgeVersion:1,callId:id,selectionEpoch:1};
 const params={action:'start',featureId:id,workspaceId:id,profileResolutionId:id,envelopeId:id};
 validateRequest('prepareExecutionAction',{...request,params});
 assert.throws(()=>validateRequest('prepareExecutionAction',{...request,params:{...params,command:'shell'}}));
 assert.throws(()=>validateRequest('prepareExecutionAction',{...request,params:{...params,grantId:id}}));
 const config={providerId:'codex',binaryHandle:id,authProfileRef:id,modelId:'fixture'};
 const intent={action:'provider.configure',intent:config,expectedRevisions:{configRevision:null}};
 const command={namespace:'execution' as const,action:'authorize',archive:'/tmp/maestro',params:intent};
 assert.ok(!buildCliArgs(command).join(' ').includes(id));
 assert.deepEqual(JSON.parse(executionCliInput(command)!),intent);
 assert.throws(()=>validateExecutionData('list',{items:[],nextCursor:null,privatePath:'/tmp/original'}));
});
