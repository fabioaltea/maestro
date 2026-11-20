import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {validateRequest} from '../../src/shared/validation.ts';
import {blocksMutation} from '../../src/main/confirmations.ts';
import {validateExecutionData} from '../../src/shared/execution-contract.ts';

test('execution controls stay scoped while the active start receipt is pending',()=>{
 const id=randomUUID(),base={bridgeVersion:1,callId:id,selectionEpoch:2};
 validateRequest('prepareExecutionAction',{...base,params:{action:'answer',interactionId:id,expectedRevision:'4',answerArtifactId:id}});
 assert.throws(()=>validateRequest('prepareExecutionAction',{...base,params:{action:'cancel',sessionId:id,expectedStateRevision:'4',pid:42}}));
 assert.throws(()=>validateExecutionData('output.list',{runId:id,watermark:'0',chunks:[],truncated:false,nextCursor:null,rawStderr:'private'}));
 const receipt={archivePath:'/tmp/state',namespace:'execution',action:'start',projectId:id,phase:'RECONCILING',outcome:'IN_PROGRESS'};
 assert.equal(blocksMutation([receipt],receipt.archivePath,'execution','cancel',id),false);
 assert.equal(blocksMutation([receipt],receipt.archivePath,'execution','start',id),true);
});
