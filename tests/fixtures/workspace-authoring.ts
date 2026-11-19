import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import type {TestContext} from 'node:test';
import {featureAuthoringFixture} from './feature-authoring.js';
import {featureDraft} from './feature-boundary.js';
import {createFilesystemIdentity} from '../../src/platform/macos/git/filesystem-identity.js';
import type {WorkspaceMutationTarget} from '../../src/ports/workspace.js';

export async function workspaceAuthoringFixture(t:TestContext){
 const f=await featureAuthoringFixture(t,{baseBranch:'fixture-base'});
 const root=join(f.repositories.directory,'maestro-owned');
 await mkdir(root,{mode:0o700});
 const ownedRoot=await createFilesystemIdentity().capture(root,'directory');
 const project=f.store.getProject(f.projectId)!.project;
 const baseOid=(await f.repositories.git(f.repo,['rev-parse','HEAD'])).trim();
 async function approvedFeature(){
   const artifactId=await f.upload(featureDraft());
   const create=await f.prepareFeature('create',{projectId:f.projectId,expectedConfigRevision:'1',bundleArtifactId:artifactId});
   const created=await f.execute('create',String(create.grantId));
   assert.equal(created.operation?.outcome,'SUCCEEDED',JSON.stringify(created.response));
   const {featureId,revisionId}=created.operation?.result as {featureId:string;revisionId:string};
   const approve=await f.prepareFeature('approve',{featureId,revisionId,expectedStateRevision:'1',acceptedUnknownIds:[]});
   assert.equal((await f.execute('approve',String(approve.grantId))).operation?.outcome,'SUCCEEDED');
   const handoff=await f.prepareFeature('handoff',{featureId,revisionId,expectedStateRevision:'2'});
   const issued=await f.execute('handoff',String(handoff.grantId));
   assert.equal(issued.operation?.outcome,'SUCCEEDED');
   const envelope=f.store.readFeatureState({kind:'envelope',id:String(issued.operation?.result?.envelopeId)}).envelope!;
   return{featureId,revisionId,artifactId,envelope};
 }
 function target(featureId:string,workspaceId=randomUUID()):WorkspaceMutationTarget{
   return{workspaceId,featureId,ownedRoot,reference:project.referenceCheckout.root,adminDirectory:project.referenceCheckout.adminDirectory,
     commonDirectory:project.repositoryIdentity.commonDirectory,baseRef:`refs/heads/${project.baseBranch}`,baseOid};
 }
 return{...f,root,ownedRoot,project,baseOid,approvedFeature,target};
}
