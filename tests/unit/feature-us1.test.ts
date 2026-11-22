import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {loadContract} from '../fixtures/load-contract.js';
import {validateFeatureBundle} from '../../src/domain/features/bundle.js';
import {featureDraft} from '../fixtures/feature-boundary.js';
interface Proof{projectId:string;configRevision:string;discoveryApprovalId:string;discoveryRevisionId:string;contextDigest:string;checkedAt:string}
test('US1 context binding refuses a missing or mismatched Discovery proof',async()=>{
 const {requireFeatureContext}=await loadContract<{requireFeatureContext(proof:Proof|null,projectId:string,configRevision:string):void}>('domain/features/model.js',['requireFeatureContext']);
 const projectId=randomUUID(),proof={projectId,configRevision:'1',discoveryApprovalId:randomUUID(),discoveryRevisionId:randomUUID(),contextDigest:'a'.repeat(64),checkedAt:new Date().toISOString()};requireFeatureContext(proof,projectId,'1');
 for(const p of [null,{...proof,projectId:randomUUID()},{...proof,configRevision:'2'},{...proof,contextDigest:'unknown'}])assert.throws(()=>requireFeatureContext(p,projectId,'1'));
});
test('US1 bounded documents are detached from mutable caller data and cannot invent source membership',()=>{
 const input=featureDraft(),sealed=validateFeatureBundle(input);input.title='changed';assert.equal(sealed.title,'A local feature');
 assert.throws(()=>validateFeatureBundle({...featureDraft(),title:'x'.repeat(121)}));
 const source={kind:'CODE' as const,text:'claim',sourceId:'SOURCE',answerId:null};assert.throws(()=>validateFeatureBundle({...featureDraft(),provenance:[source]},{sourceIds:[],answerIds:[]}));
 const criteria=Array.from({length:50},(_,i)=>({...featureDraft().acceptanceCriteria[0]!,criterionId:`AC${i}`}));validateFeatureBundle({...featureDraft(),acceptanceCriteria:criteria});
 assert.throws(()=>validateFeatureBundle({...featureDraft(),acceptanceCriteria:[...criteria,{...criteria[0]!,criterionId:'AC51'}]}));
});
