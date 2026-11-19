import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

const protocol='../../src/protocol/workspace.js';
test('workspace protocol is closed, bounded and does not accept paths, ownership claims or runtime lease methods',async()=>{
 const {validateWorkspaceParams,requireWorkspaceEnvelope}=await import(protocol);
 const featureId=randomUUID(),envelopeId=randomUUID(),workspaceId=randomUUID(),requestId=randomUUID(),grantId=randomUUID();
 assert.doesNotThrow(()=>validateWorkspaceParams('workspace.prepare',{featureId,envelopeId}));
 assert.doesNotThrow(()=>validateWorkspaceParams('workspace.create',{requestId,grantId}));
 assert.doesNotThrow(()=>validateWorkspaceParams('workspace.refresh',{workspaceId,requestId,expectedStateRevision:'3'}));
 assert.doesNotThrow(()=>validateWorkspaceParams('workspace.list',{projectId:randomUUID(),limit:20}));
 for(const params of [{featureId,envelopeId,path:'/local/private'},{featureId,envelopeId,owner:true},{featureId,envelopeId,branchRef:'forced'}]){
   assert.throws(()=>validateWorkspaceParams('workspace.prepare',params),/INVALID_REQUEST/);
 }
 assert.throws(()=>validateWorkspaceParams('workspace.create',{requestId,grantId,command:'git'}),/INVALID_REQUEST/);
 assert.throws(()=>validateWorkspaceParams('workspace.list',{projectId:randomUUID(),limit:21}),/INVALID_REQUEST/);
 assert.throws(()=>validateWorkspaceParams('workspace.lease.acquire',{workspaceId,holderId:randomUUID()}),/UNSUPPORTED_VERSION/);
 assert.throws(()=>requireWorkspaceEnvelope({metadata:'é'.repeat(16384)}),/CONTEXT_LIMIT/);
});
