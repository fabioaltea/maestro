import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {validateExecutionParams} from '../../src/protocol/execution.js';

test('answers, pause and cancel bind the current revision and use sealed references',()=>{
 const id=randomUUID();
 const p={action:'answer',intent:{interactionId:id,expectedRevision:'5',answerArtifactId:id},expectedRevisions:{stateRevision:'5'}};
 validateExecutionParams('execution.prepare',p);
 assert.throws(()=>validateExecutionParams('execution.prepare',{...p,expectedRevisions:{stateRevision:'6'}}),/INVALID_REQUEST/);
 assert.throws(()=>validateExecutionParams('execution.prepare',{...p,intent:{...p.intent,answer:'plain text'}}),/INVALID_REQUEST/);
 for(const action of ['cancel','pause']){
   validateExecutionParams('execution.prepare',{action,intent:{sessionId:id,expectedStateRevision:'2'},expectedRevisions:{stateRevision:'2'}});
   assert.throws(()=>validateExecutionParams(`execution.${action}`,{requestId:id,grantId:id,pid:123}),/INVALID_REQUEST/);
 }
});
