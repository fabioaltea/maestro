import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {buildCliArgs,reviewCliInput} from '../../src/main/core-cli.ts';
import {validateRequest} from '../../src/shared/validation.ts';
import {validateReviewData} from '../../src/shared/review-contract.ts';

test('Desktop candidate and integration use closed inputs, stdin and distinct grants',()=>{
 const ids={projectId:randomUUID(),reviewId:randomUUID(),candidateId:randomUUID(),decisionId:randomUUID()},requestId=randomUUID(),grantId=randomUUID();
 const selection={bridgeVersion:1,callId:randomUUID(),selectionEpoch:1},targetOid='a'.repeat(40);
 const command={namespace:'review' as const,action:'prepare',archive:'/tmp/archive',
   params:{...ids,action:'integrate',stateRevision:'5',expectedTargetOid:targetOid}};
 validateRequest('prepareReviewAction',{...selection,params:command.params});
 assert.throws(()=>validateRequest('prepareReviewAction',{...selection,params:{...command.params,force:true}}));
 assert.equal(buildCliArgs(command).at(-1),'--input-stdin');
 assert.deepEqual(JSON.parse(reviewCliInput(command)!),{action:'integrate',expectedRevisions:{stateRevision:'5'},
   intent:{candidateId:ids.candidateId,decisionId:ids.decisionId,expectedTargetOid:targetOid}});
 assert.deepEqual(buildCliArgs({...command,action:'integrate',requestId,params:{grantId}}).slice(-2),[`--request-id=${requestId}`,`--grant=${grantId}`]);
 assert.throws(()=>buildCliArgs({...command,action:'integrate',requestId,params:{grantId,oldOid:targetOid}}));
});

test('integration receipt data binds the original request and rejects unrelated ref proof',()=>{
 const id=randomUUID(),at='2026-11-20T14:00:00.000Z',candidate='b'.repeat(40);
 const reply={operation:{namespace:'REVIEW',action:'integrate',phase:'FINALIZED',outcome:'SUCCEEDED',requestId:id,targetId:randomUUID(),
   acceptedAt:at,completedAt:at,result:{integrationId:id,resultingOid:candidate},error:null},
   integration:{integrationId:id,phase:'FINALIZED',resultingOid:candidate,proof:{requestId:id,old:'a'.repeat(40),candidate,guardSynced:true}}};
 assert.deepEqual(validateReviewData('operation',reply,{requestId:id}),reply);
 assert.throws(()=>validateReviewData('operation',reply,{requestId:randomUUID()}));
 assert.throws(()=>validateReviewData('operation',{...reply,integration:{...reply.integration,proof:{...reply.integration.proof,requestId:randomUUID()}}},{requestId:id}));
});
