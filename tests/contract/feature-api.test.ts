import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {validateFeatureParams,requireFeatureEnvelope,publicFeatureOperation,FEATURE_READ_METHODS} from '../../src/protocol/feature.js';
const id=()=>randomUUID();
test('feature API uses closed typed DTOs and bound artifact chunks instead of client paths or commands',()=>{
 validateFeatureParams('feature.prepare',{action:'create',projectId:id(),expectedConfigRevision:'1',bundleArtifactId:id()});
 validateFeatureParams('feature.create',{requestId:id(),grantId:id()});
 validateFeatureParams('feature.artifact.append',{requestId:id(),uploadId:id(),offset:0,chunkSha256:'a'.repeat(64),base64:Buffer.from('data').toString('base64')});
 for(const [method,p] of [
 ['feature.create',{requestId:id(),grantId:id(),approved:true}],['feature.get',{featureId:'../../state.sqlite'}],
 ['feature.prepare',{action:'create',projectId:id(),expectedConfigRevision:'1',bundleArtifactId:id(),command:'shell'}],
 ['feature.prepare',{action:'archive',featureId:id(),expectedStateRevision:'0'}],
 ['feature.list',{projectId:id(),limit:21}],['feature.list',{projectId:id(),cursor:'x'.repeat(4097)}],
 ['feature.artifact.append',{requestId:id(),uploadId:id(),offset:-1,chunkSha256:'a'.repeat(64),base64:'AA=='}],
 ['feature.artifact.append',{requestId:id(),uploadId:id(),offset:0,chunkSha256:'a'.repeat(64),base64:Buffer.alloc(8193).toString('base64')}],
 ['feature.artifact.reserve',{requestId:id(),kind:'BUNDLE',expectedBytes:262145,sha256:'a'.repeat(64)}],
 ] as const)assert.throws(()=>validateFeatureParams(method,p));
 assert.throws(()=>validateFeatureParams('feature.exec',{command:'shell'}));
});
test('public feature operation omits private canonical content and results are bounded',()=>{
 const result=publicFeatureOperation({requestId:id(),namespace:'FEATURE',action:'create',phase:'FINALIZED',outcome:'SUCCEEDED',targetId:id(),acceptedAt:new Date().toISOString(),completedAt:new Date().toISOString(),result:{featureId:id()},error:null,canonicalIntent:'PRIVATE_SENTINEL',payloadHash:'a'.repeat(64)});
 assert.doesNotMatch(JSON.stringify(result),/PRIVATE_SENTINEL|canonicalIntent|payloadHash/);
 assert.ok(FEATURE_READ_METHODS.includes('feature.operation.get'));
 requireFeatureEnvelope(result);assert.throws(()=>requireFeatureEnvelope({text:'x'.repeat(32769)}));
});
