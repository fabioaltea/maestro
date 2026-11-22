import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {validateProfileParams} from '../../src/protocol/profile.js';

test('profile scope and versioned resolve are closed',()=>{
 const projectId=randomUUID(),bundleArtifactId=randomUUID();
 const make=(scope:string,intent:Record<string,unknown>)=>({action:'create',intent:{scope,bundleArtifactId,...intent},expectedRevisions:{}});
 validateProfileParams('profile.prepare',make('PROJECT',{projectId}));
 assert.throws(()=>validateProfileParams('profile.prepare',make('GLOBAL',{projectId})),/INVALID_REQUEST/);
 assert.throws(()=>validateProfileParams('profile.prepare',make('PROJECT',{})),/INVALID_REQUEST/);
 const resolve={profileId:randomUUID(),revisionId:randomUUID(),projectId,providerCapabilityDigest:'a'.repeat(64),requestId:randomUUID()};
 validateProfileParams('profile.resolve',resolve);
 assert.throws(()=>validateProfileParams('profile.resolve',{...resolve,permissions:['WORKSPACE_WRITE']}),/INVALID_REQUEST/);
});
