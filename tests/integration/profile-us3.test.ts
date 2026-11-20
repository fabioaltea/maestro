import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {profileRuntimeFixture} from '../fixtures/profile-runtime.js';

test('tool manifests stay inert, MCP remains unavailable, and revoke invalidates a qualified fixture snapshot',async t=>{
 const {composeProfileServices}=await import(new URL('../../src/core/profiles/registry.js',import.meta.url).href);
 const f=await profileRuntimeFixture(t,context=>composeProfileServices(context,{runtime:{allow:['WORKSPACE_READ','TOOL_LOCAL'],deny:[]},
   project:{allow:['WORKSPACE_READ','TOOL_LOCAL'],deny:[]}}));
 const settings={title:'Fixture tool',version:'1.0.0',argvSchema:[],inputBytes:1024,outputBytes:4096,credentialRequirements:[],networkScope:'OFFLINE'};
 async function add(kind:string){
   const manifest=await f.upload({...settings,alias:kind==='MCP'?'mcp-fixture':'local-fixture',kind,
     ...(kind==='MCP'?{endpointRef:randomUUID(),requiredPermissions:['TOOL_MCP']}:{commandSpecId:randomUUID(),requiredPermissions:['TOOL_LOCAL']})});
   const approval=await f.prepare('tool.import',{manifestArtifactId:manifest.artifactId,sourceDigest:manifest.sha256});
   return (await f.mutate('tool.import',approval.grantId)).result;
 }
 const mcp=await add('MCP'),local=await add('LOCAL_COMMAND');
 const enable=(tool:Record<string,string>,permissions:string[])=>({toolId:tool.entityId,revisionId:tool.revisionId,permissions});
 assert.equal(((await f.call('prepare',{action:'tool.enable',intent:enable(mcp,['TOOL_MCP']),expectedRevisions:{stateRevision:'1'}})).data as {code:string}).code,'CAPABILITY_UNAVAILABLE');
 assert.equal(((await f.call('prepare',{action:'tool.enable',intent:enable(local,['TOOL_LOCAL','WORKSPACE_WRITE']),expectedRevisions:{stateRevision:'1'}})).data as {code:string}).code,'PERMISSION_CONFLICT');
 const grant=await f.prepare('tool.enable',enable(local,['TOOL_LOCAL']),'1');
 const enabled=(await f.mutate('tool.enable',grant.grantId)).result;
 const content=await f.upload({alias:'qa-with-tool',title:'QA with tool',role:'QA',instructions:'Fixture text',
   permissions:{allow:['WORKSPACE_READ','TOOL_LOCAL'],deny:[],required:['WORKSPACE_READ']},
   toolRefs:[{entityId:enabled.entityId,revisionId:enabled.revisionId}]});
 const profile=(await f.mutate('create',(await f.prepare('create',{scope:'GLOBAL',bundleArtifactId:content.artifactId})).grantId)).result;
 const cap=(await f.ok('capabilities')).capability as {digest:string};
 const params={profileId:profile.entityId,revisionId:profile.revisionId,projectId:f.projectId,providerCapabilityDigest:cap.digest,requestId:randomUUID()};
 await f.ok('resolve',params);
 const resolved=(await f.ok('resolution.get',{resolutionId:params.requestId})).resolution as {snapshot:{tools:unknown[]}};
 assert.equal(resolved.snapshot.tools.length,1);
 const discard=await f.prepare('disable',{targetId:enabled.entityId,expectedStateRevision:'2'},'2');await f.mutate('disable',discard.grantId);
 assert.equal((await f.ok('resolution.get',{resolutionId:params.requestId})).currentness,'STALE');
 assert.equal(((await f.call('resolve',{...params,requestId:randomUUID()})).data as {code:string}).code,'TOOL_DISABLED');
});
