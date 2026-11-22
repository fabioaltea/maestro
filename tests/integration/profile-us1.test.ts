import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {profileRuntimeFixture} from '../fixtures/profile-runtime.js';

test('six seed roles are inert, exact resolutions survive a revision, and a second grant cannot overwrite it',async t=>{
 const f=await profileRuntimeFixture(t);
 const list=(await f.ok('list',{kind:'PROFILE'})).items as {entityId:string;alias:string;revisionId:string;stateRevision:string}[];
 assert.deepEqual(list.map(item=>item.alias),['backend','frontend','project-architect','qa','release-manager','reviewer']);
 const profile=list.find(item=>item.alias==='reviewer')!,cap=(await f.ok('capabilities')).capability as {digest:string};
 const params={profileId:profile.entityId,revisionId:profile.revisionId,projectId:f.projectId,providerCapabilityDigest:cap.digest,requestId:randomUUID()};
 const first=await f.ok('resolve',params);
 assert.deepEqual(await f.ok('resolve',params),first);
 assert.equal((await f.ok('resolution.get',{resolutionId:params.requestId})).currentness,'CURRENT');
 assert.equal((await f.call('resolve',{...params,requestId:randomUUID(),providerCapabilityDigest:'x'.repeat(64)})).result,'ERROR');
 const bundle=await f.upload({alias:'reviewer',title:'Reviewer aggiornato',role:'Reviewer',instructions:'Testo revisione nuova.'});
 const intent={profileId:profile.entityId,bundleArtifactId:bundle.artifactId};
 const approval=await f.prepare('revise',intent,profile.stateRevision);
 const competing=await f.prepare('revise',intent,profile.stateRevision);
 const edited=await f.mutate('revise',approval.grantId);
 assert.notEqual(edited.result.revisionId,profile.revisionId);
 assert.equal((await f.call('revise',{grantId:competing.grantId,requestId:randomUUID()})).result,'ERROR');
 assert.equal((await f.ok('resolution.get',{resolutionId:params.requestId})).currentness,'STALE');
 const historical=(await f.ok('get',{entityId:profile.entityId,revisionId:profile.revisionId})).revision as {document:{title:string}};
 assert.equal(historical.document.title,'Reviewer');
 const d=await f.prepare('disable',{targetId:profile.entityId,expectedStateRevision:'2'},'2');
 await f.mutate('disable',d.grantId);
 assert.equal((await f.call('resolve',{...params,requestId:randomUUID(),revisionId:edited.result.revisionId})).result,'ERROR');
});
