import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {featureAuthoringFixture} from '../fixtures/feature-authoring.js';
import {featureDraft} from '../fixtures/feature-boundary.js';

const questions={kind:'QUESTIONS',questions:[{questionId:'Q1',text:'Quale stato mostrare?',reason:'Ambito da confermare'}]};
const capabilities={readonlyPlanning:true as const,qualified:true as const};
type Identity={runId:string;generation:string;owningInstanceId:string};
const exit=(identity:Identity)=>({...identity,hostExited:true as const,providerExited:true as const});

async function create(f:Awaited<ReturnType<typeof featureAuthoringFixture>>){
  const artifactId=await f.upload(featureDraft());
  const grant=await f.prepareFeature('create',{projectId:f.projectId,expectedConfigRevision:'1',bundleArtifactId:artifactId});
  const created=await f.execute('create',String(grant.grantId));
  assert.equal(created.operation?.outcome,'SUCCEEDED');
  return String(created.operation?.result?.featureId);
}

test('US3 two explicit turns retain question/answer provenance, deduplicate retries and allow plan approval',async t=>{
  let invocations=0;
  const planning={capabilities,async check(){},async cancel(identity:Identity){return exit(identity);},async reconcile(){return null;},
    async run(input:{identity:Identity;answers:readonly {answerId:string;text:string}[]}){
      invocations++;
      const answer=input.answers[0];
      if(!answer)return{exit:exit(input.identity),value:questions};
      assert.equal(answer.text,'Mostra lo stato locale');
      return{exit:exit(input.identity),value:{kind:'DRAFT',bundle:{...featureDraft(),provenance:[{kind:'USER_CONFIRMED',text:'Stato locale',sourceId:null,answerId:answer.answerId}]}}};
    }};
  const f=await featureAuthoringFixture(t,{planning});
  const featureId=await create(f),contextSnapshotId=f.discovery().snapshotId;
  const grant=await f.prepareFeature('generate',{featureId,expectedStateRevision:'1',contextSnapshotId});
  const first=await f.execute('generate',String(grant.grantId));
  assert.equal(first.operation?.outcome,'SUCCEEDED');
  const turnId=String(first.operation?.result?.turnId);
  const waiting=f.store.readFeatureState({kind:'feature',id:featureId}).feature!;
  assert.equal(waiting.state,'WAITING_USER');
  const read=await f.send('feature.questions.list',{featureId});
  assert.equal(read.result,'OK',JSON.stringify(read));
  assert.deepEqual((read.data as {items:unknown[]}).items,questions.questions);
  const artifact=await f.uploadInput('Mostra lo stato locale',featureId);
  const answer=await f.prepareFeature('answer',{featureId,expectedStateRevision:waiting.stateRevision,turnId,questionId:'Q1',answerArtifactId:artifact});
  const wrong=await f.send('feature.cancel',{requestId:randomUUID(),grantId:answer.grantId});
  assert.equal((wrong.data as {code:string}).code,'APPROVAL_REQUIRED');
  const second=await f.execute('answer',String(answer.grantId));
  assert.equal(second.operation?.outcome,'SUCCEEDED');
  assert.deepEqual((await f.execute('answer',String(answer.grantId),second.requestId)).operation,second.operation);
  assert.equal(invocations,2);
  const ready=f.store.readFeatureState({kind:'feature',id:featureId}).feature!;
  assert.equal(ready.state,'READY_FOR_APPROVAL');
  assert.notEqual(ready.currentRevisionId,waiting.currentRevisionId);
  const approval=await f.prepareFeature('approve',{featureId,revisionId:ready.currentRevisionId,expectedStateRevision:ready.stateRevision,acceptedUnknownIds:[]});
  assert.equal((await f.execute('approve',String(approval.grantId))).operation?.outcome,'SUCCEEDED');
});

test('US3 cancellation requires exit evidence and discards results that arrive after cancellation',async t=>{
  let started!:()=>void,finish!:(value:{exit:ReturnType<typeof exit>;value:unknown})=>void,identity!:Identity;
  const running=new Promise<void>(resolve=>{started=resolve;});
  const pending=new Promise<{exit:ReturnType<typeof exit>;value:unknown}>(resolve=>{finish=resolve;});
  const planning={capabilities,async check(){},async cancel(run:Identity){return exit(run);},async reconcile(){return null;},
    run(input:{identity:Identity}){identity=input.identity;started();return pending;}};
  const f=await featureAuthoringFixture(t,{planning});
  const featureId=await create(f),contextSnapshotId=f.discovery().snapshotId;
  const generation=await f.prepareFeature('generate',{featureId,expectedStateRevision:'1',contextSnapshotId});
  const requestId=randomUUID();
  assert.equal((await f.send('feature.generate',{requestId,grantId:generation.grantId})).result,'OK');
  await running;
  const before=f.store.readFeatureState({kind:'feature',id:featureId}).feature!;
  try{
    const cancel=await f.prepareFeature('cancel',{featureId,expectedStateRevision:before.stateRevision});
    assert.equal((await f.send('feature.cancel',{requestId:randomUUID(),grantId:cancel.grantId})).result,'OK');
  }finally{finish({exit:exit(identity),value:{kind:'DRAFT',bundle:featureDraft()}});}
  await f.runtime.idle();
  const after=f.store.readFeatureState({kind:'feature',id:featureId}).feature!;
  assert.equal(after.state,'INTERRUPTED');
  assert.equal(after.currentRevisionId,before.currentRevisionId);
  assert.equal(f.store.readFeatureState({kind:'operation',id:requestId}).operation?.outcome,'INTERRUPTED');
});

test('US3 preserves original requests across pre-admission and post-completion interruptions',async t=>{
  let launches=0,fault:'pre'|'post'|'none'='pre';
  const planning={capabilities,async check(){},async cancel(identity:Identity){return exit(identity);},async reconcile(){return null;},
    async run({identity}: {identity:Identity}){launches++;return{exit:exit(identity),value:{kind:'DRAFT',bundle:featureDraft()}};}};
  const f=await featureAuthoringFixture(t,{planning,planningFault(kind,point){
    if(fault==='pre'&&kind==='planning.admit'&&point==='before'||fault==='post'&&kind==='planning.complete'&&point==='after'){
      fault='none';throw new Error('DEADLINE_EXCEEDED');
    }
  }});
  const featureId=await create(f),contextSnapshotId=f.discovery().snapshotId;
  const params={featureId,expectedStateRevision:'1',contextSnapshotId};
  const grant=await f.prepareFeature('generate',params);
  const requestId=randomUUID();
  const rejected=await f.execute('generate',String(grant.grantId),requestId);
  assert.equal(rejected.operation,null);
  assert.equal(launches,0);
  fault='post';
  const terminal=await f.execute('generate',String(grant.grantId),requestId);
  assert.equal(terminal.operation?.outcome,'SUCCEEDED');
  assert.deepEqual((await f.execute('generate',String(grant.grantId),requestId)).operation,terminal.operation);
  assert.equal(launches,1);
});

test('US3 deadline and unverified cancellation retain the lease until authenticated recovery',async t=>{
  let elapsed=0,reconcile=false,attempts=0;
  const clock={wallUtc:()=>new Date().toISOString(),monotonicNow:()=>elapsed};
  const planning={capabilities,async check(){},async cancel(identity:Identity){return exit({...identity,generation:randomUUID()});},
    async reconcile(identity:Identity){return reconcile?exit(identity):null;},
    run(){attempts++;elapsed+=600001;return new Promise<never>(()=>{});}};
  const f=await featureAuthoringFixture(t,{planning,clock});
  const featureId=await create(f),contextSnapshotId=f.discovery().snapshotId;
  const generation=await f.prepareFeature('generate',{featureId,expectedStateRevision:'1',contextSnapshotId});
  const result=await f.execute('generate',String(generation.grantId));
  assert.equal(attempts,1);
  assert.equal(result.operation?.outcome,'UNKNOWN');
  assert.equal(f.store.readFeatureState({kind:'feature',id:featureId}).feature?.state,'RECONCILING');
  await f.runtime.recover();
  assert.equal(f.store.readFeatureState({kind:'operation',id:result.requestId}).operation?.outcome,'UNKNOWN');
  reconcile=true;
  await f.runtime.recover();
  assert.equal(f.store.readFeatureState({kind:'operation',id:result.requestId}).operation?.outcome,'INTERRUPTED');
  assert.equal(f.store.readFeatureState({kind:'feature',id:featureId}).feature?.state,'INTERRUPTED');
  assert.equal(attempts,1);
});

test('US3 preflight authentication, unsafe profile and quota failures preserve the manual bundle',async t=>{
  let code='PROVIDER_UNSAFE',launches=0;
  const planning={capabilities,async check(){throw new Error(code);},async cancel(){return null;},async reconcile(){return null;},
    async run(){launches++;throw new Error('INVALID_TRANSITION');}};
  const f=await featureAuthoringFixture(t,{planning});
  const featureId=await create(f),contextSnapshotId=f.discovery().snapshotId;
  const base=f.store.readFeatureState({kind:'feature',id:featureId}).feature!;
  for(const failure of ['PROVIDER_UNSAFE','PROVIDER_AUTH_REQUIRED','PROVIDER_QUOTA']){
    code=failure;
    const current=f.store.readFeatureState({kind:'feature',id:featureId}).feature!;
    const grant=await f.prepareFeature('generate',{featureId,expectedStateRevision:current.stateRevision,contextSnapshotId});
    const result=await f.execute('generate',String(grant.grantId));
    assert.equal(result.operation?.error,failure);
    assert.equal(f.store.readFeatureState({kind:'feature',id:featureId}).feature?.currentRevisionId,base.currentRevisionId);
  }
  assert.equal(launches,0);
  const current=f.store.readFeatureState({kind:'feature',id:featureId}).feature!;
  const artifactId=await f.upload({...featureDraft(),request:'Versione manuale'});
  const revise=await f.prepareFeature('revise',{featureId,expectedStateRevision:current.stateRevision,bundleArtifactId:artifactId});
  assert.equal((await f.execute('revise',String(revise.grantId))).operation?.outcome,'SUCCEEDED');
});
