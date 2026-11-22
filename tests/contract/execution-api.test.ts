import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {decodeRequest} from '../../src/protocol/validation.js';
import {decodeExecutionOperation,executionCapabilities,requireExecutionEnvelope,validateExecutionParams} from '../../src/protocol/execution.js';

test('execution wire accepts closed messages and rejects secrets, shell commands and unrelated capabilities',()=>{
 const id=randomUUID();
 assert.doesNotThrow(()=>decodeRequest(JSON.stringify({protocolVersion:1,correlationId:id,method:'execution.get',params:{sessionId:id}})));
 assert.throws(()=>validateExecutionParams('execution.start',{requestId:id,grantId:id,args:['sh','-c']}),/INVALID_REQUEST/);
 assert.throws(()=>validateExecutionParams('execution.provider.check',{requestId:id,providerId:'other',expectedConfigRevision:'1'}),/INVALID_REQUEST/);
 assert.throws(()=>validateExecutionParams('execution.provider.configure',{requestId:id,grantId:id,apiKey:'secret'}),/INVALID_REQUEST/);
 assert.throws(()=>validateExecutionParams('execution.list',{projectId:id,limit:21}),/INVALID_REQUEST/);
 assert.throws(()=>requireExecutionEnvelope({data:'x'.repeat(32768)}),/CONTEXT_LIMIT|INVALID_REQUEST/);
 assert.throws(()=>executionCapabilities({profileVersion:1,profileMethods:['execution.start']},'execution.start'),/UNSUPPORTED_VERSION/);
 assert.throws(()=>decodeExecutionOperation({namespace:'PROFILE'}),/INVALID_REQUEST/);
});
