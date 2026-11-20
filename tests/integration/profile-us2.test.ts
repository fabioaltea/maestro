import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {profileRuntimeFixture} from '../fixtures/profile-runtime.js';
import {profileBoundaryFixture} from '../fixtures/profile-boundary.js';

test('skill preview and import keep exact scope, detect edited files, and never execute source',async t=>{
 const f=await profileRuntimeFixture(t),{source}=await profileBoundaryFixture(t);
 const seed=((await f.ok('list',{kind:'PROFILE'})).items as {alias:string;entityId:string;revisionId:string;stateRevision:string}[]).find(x=>x.alias==='reviewer')!;
 const cap=(await f.ok('capabilities')).capability as {digest:string};
 const add=async(scope:string)=>{
   const {importHandle}=await f.ok('skill.source',{source}),requestId=randomUUID();
   const params={scope,requestId,importHandle,...(scope==='PROJECT'?{projectId:f.projectId}:scope==='PROFILE'?{ownerProfileId:seed.entityId}:{})};
   const preview=await f.ok('skill.preview',params);
   assert.equal(JSON.stringify(preview).includes(source),false);
   const {previewId,sourceDigest}=preview.preview as {previewId:string;sourceDigest:string};
   const approval=await f.prepare('skill.import',{previewId,sourceDigest});
   return{grantId:approval.grantId,params};
 };
 const stale=await add('GLOBAL');
 await writeFile(join(source,'SKILL.md'),'# Revised fixture\n');
 assert.equal((await f.call('skill.import',{grantId:stale.grantId,requestId:randomUUID()})).result,'ERROR');
 const imported=[];
 for(const scope of ['GLOBAL','PROJECT','PROFILE']){
   const {grantId,params}=await add(scope),requestId=randomUUID();
   const result=await f.mutate('skill.import',grantId,requestId);
   assert.deepEqual(await f.mutate('skill.import',grantId,requestId),result);
   const replay=await f.ok('skill.preview',params);
   assert.equal((replay.preview as {previewId:string}).previewId,params.requestId);
   imported.push(result.result);
 }
 const bind=async(ref:Record<string,string>,stateRevision:string,revisionId:string)=>{
   const approval=await f.prepare('skill.bind',{profileId:seed.entityId,revisionId,
     requiredRefs:[{entityId:ref.entityId,revisionId:ref.revisionId}],recommendedRefs:[]},stateRevision);
   return (await f.mutate('skill.bind',approval.grantId)).result;
 };
 const bound=await bind(imported[0]!,'1',seed.revisionId);
 const resolve=(revisionId:string)=>({requestId:randomUUID(),profileId:seed.entityId,revisionId,projectId:f.projectId,providerCapabilityDigest:cap.digest});
 assert.equal(((await f.call('resolve',resolve(bound.revisionId!))).data as {code:string}).code,'PROFILE_CONFLICT');
 const final=await bind(imported[2]!,'2',bound.revisionId!);
 const params=resolve(final.revisionId!);
 await f.ok('resolve',params);
 const snapshot=((await f.ok('resolution.get',{resolutionId:params.requestId})).resolution as {snapshot:{skills:{entityId:string}[]}}).snapshot;
 assert.deepEqual(snapshot.skills.map(x=>x.entityId),[imported[2]!.entityId]);
});
