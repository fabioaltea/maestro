import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {validateExecutionParams} from '../../src/protocol/execution.js';

test('resume is an explicit new grant and native resume is absent from the contract',()=>{
 const id=randomUUID();
 const p={action:'resume',intent:{sessionId:id,checkpointId:id,providerId:'codex'},expectedRevisions:{stateRevision:'5'}};
 validateExecutionParams('execution.prepare',p);
 assert.throws(()=>validateExecutionParams('execution.prepare',{...p,intent:{...p.intent,nativeResume:true}}),/INVALID_REQUEST/);
 assert.throws(()=>validateExecutionParams('execution.resume',{requestId:id,checkpointId:id}),/INVALID_REQUEST/);
 assert.throws(()=>validateExecutionParams('execution.reconcile',{requestId:id,sessionId:id,pid:17}),/INVALID_REQUEST/);
});
