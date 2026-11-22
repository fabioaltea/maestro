import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {featureAuthoringFixture} from '../fixtures/feature-authoring.js';
import {featureDraft} from '../fixtures/feature-boundary.js';
test('US1 manual create/revise keeps immutable revisions, original UUID outcome and project files',async t=>{
 const f=await featureAuthoringFixture(t),before=await f.repositories.snapshotTree(f.repo),bundle=featureDraft(),artifactId=await f.upload(bundle);
 const prepared=await f.prepareFeature('create',{projectId:f.projectId,expectedConfigRevision:'1',bundleArtifactId:artifactId});
 const result=await f.execute('create',prepared.grantId as string);assert.equal(result.operation!.outcome,'SUCCEEDED');const featureId=result.operation!.result!.featureId as string;
 const first=f.store.readFeatureState({kind:'feature',id:featureId}).feature!;assert.equal(first.state,'DRAFT');assert.equal(first.stateRevision,'1');
 const original=f.store.readSnapshot()!.store.revision;
 for(let i=0;i<10;i++){const replay=await f.execute('create',prepared.grantId as string,result.requestId);assert.deepEqual(replay.operation,result.operation);}
 assert.equal(f.store.readSnapshot()!.store.revision,original,'replay cannot publish duplicate metadata events');
 const revised=await f.upload({...bundle,title:'Revised feature'}),g=await f.prepareFeature('revise',{featureId,expectedStateRevision:'1',bundleArtifactId:revised});assert.equal((await f.execute('revise',g.grantId as string)).operation!.outcome,'SUCCEEDED');
 const revisions=f.store.readFeatureState({kind:'revisions',id:featureId}).items!;assert.equal(revisions.length,2);assert.equal(f.store.readFeatureState({kind:'feature',id:featureId}).feature!.stateRevision,'2');
 assert.deepEqual(await f.repositories.snapshotTree(f.repo),before);
});
test('US1 changed source after consent blocks creation without replacing or fabricating Discovery',async t=>{
 const f=await featureAuthoringFixture(t),artifactId=await f.upload(featureDraft()),prepared=await f.prepareFeature('create',{projectId:f.projectId,expectedConfigRevision:'1',bundleArtifactId:artifactId});
 await writeFile(join(f.repo,'tracked.txt'),'changed after approval\n');const before=await f.repositories.snapshotTree(f.repo);
 const result=await f.execute('create',prepared.grantId as string);assert.notEqual(result.operation!.outcome,'SUCCEEDED');assert.ok(['APPROVAL_STALE','CONTEXT_CHANGED','DISCOVERY_REQUIRED'].includes(result.operation!.error!));
 assert.deepEqual(f.store.readFeatureState({kind:'features',id:f.projectId}).items,[]);assert.deepEqual(await f.repositories.snapshotTree(f.repo),before);
});
test('US1 concurrent revisions and archive preserve version checks and retained artifacts',async t=>{
 const f=await featureAuthoringFixture(t),id=await f.upload(featureDraft()),g=await f.prepareFeature('create',{projectId:f.projectId,expectedConfigRevision:'1',bundleArtifactId:id}),created=await f.execute('create',g.grantId as string),featureId=created.operation!.result!.featureId as string;
 const [a,b]=await Promise.all([f.upload({...featureDraft(),title:'one'}),f.upload({...featureDraft(),title:'two'})]);
 const [ga,gb]=await Promise.all([f.prepareFeature('revise',{featureId,expectedStateRevision:'1',bundleArtifactId:a}),f.prepareFeature('revise',{featureId,expectedStateRevision:'1',bundleArtifactId:b})]);
 const results=await Promise.all([f.execute('revise',ga.grantId as string),f.execute('revise',gb.grantId as string)]);assert.equal(results.filter(r=>r.operation?.outcome==='SUCCEEDED').length,1);assert.equal(f.store.readFeatureState({kind:'revisions',id:featureId}).items!.length,2);
 const latest=f.store.readFeatureState({kind:'feature',id:featureId}).feature!,archive=await f.prepareFeature('archive',{featureId,expectedStateRevision:latest.stateRevision});assert.equal((await f.execute('archive',archive.grantId as string)).operation!.outcome,'SUCCEEDED');
 assert.equal(f.store.readFeatureState({kind:'feature',id:featureId}).feature!.state,'ARCHIVED');assert.equal(f.store.readFeatureState({kind:'revisions',id:featureId}).items!.length,2);
 await assert.rejects(()=>f.prepareFeature('revise',{featureId,expectedStateRevision:'1',bundleArtifactId:id}));
});
test('US1 a lost writer reply after create is resolved by the original UUID without duplicate completion events',async t=>{
 const f=await featureAuthoringFixture(t,{loseCreateReply:true}),id=await f.upload(featureDraft()),g=await f.prepareFeature('create',{projectId:f.projectId,expectedConfigRevision:'1',bundleArtifactId:id});
 const result=await f.execute('create',g.grantId as string);assert.equal(result.operation!.outcome,'SUCCEEDED');
 const retry=await f.execute('create',g.grantId as string,result.requestId);assert.deepEqual(retry.operation,result.operation);
 const events=f.store.listEvents({limit:100}).records.filter(e=>e.operationId===result.requestId&&e.type==='operation.completed');assert.equal(events.length,1);
 assert.equal(f.store.readFeatureState({kind:'features',id:f.projectId}).items!.length,1);
});

test('SC-001 creates, reads and revises ten distinct plans with current Discovery',async t=>{
 const f=await featureAuthoringFixture(t);
 const before=await f.repositories.snapshotTree(f.repo);
 for(let index=1;index<=10;index++){
   const title=`Feature fixture ${index}`;
   const original={...featureDraft(),title,request:`Richiesta iniziale ${index}`};
   const firstArtifactId=await f.upload(original);
   const create=await f.prepareFeature('create',{projectId:f.projectId,expectedConfigRevision:'1',bundleArtifactId:firstArtifactId});
   const created=await f.execute('create',String(create.grantId));
   assert.equal(created.operation?.outcome,'SUCCEEDED',JSON.stringify(created.response));
   const featureId=String(created.operation?.result?.featureId),revisionId=String(created.operation?.result?.revisionId);
   const feature=f.checked(await f.send('feature.get',{featureId})).feature as {title:string;currentRevisionId:string};
   assert.equal(feature.title,title);
   assert.equal(feature.currentRevisionId,revisionId);

   const revised={...original,request:`Richiesta corretta ${index}`};
   const nextArtifactId=await f.upload(revised);
   const revise=await f.prepareFeature('revise',{featureId,expectedStateRevision:'1',bundleArtifactId:nextArtifactId});
   const changed=await f.execute('revise',String(revise.grantId));
   assert.equal(changed.operation?.outcome,'SUCCEEDED',JSON.stringify(changed.response));
   const revisions=f.checked(await f.send('feature.revisions.list',{featureId})).items as {revisionId:string;artifactId:string;parentRevisionId:string|null}[];
   assert.equal(revisions.length,2);
   assert.equal(revisions[0]?.revisionId,revisionId);
   assert.equal(revisions[1]?.parentRevisionId,revisionId);
   for(const [revision,bundle] of [[revisions[0]!,original],[revisions[1]!,revised]] as const){
     const chunk=f.checked(await f.send('feature.artifact.get',{artifactId:revision.artifactId}));
     assert.deepEqual(JSON.parse(Buffer.from(String(chunk.base64),'base64').toString('utf8')),bundle);
   }
 }
 const features=f.checked(await f.send('feature.list',{projectId:f.projectId})).items as unknown[];
 assert.equal(features.length,10);
 assert.deepEqual(await f.repositories.snapshotTree(f.repo),before);
});
