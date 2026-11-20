import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,link,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createDiscoveryInferenceServer} from '../fixtures/discovery-inference-server.js';
import {createCodexInvocation} from '../../src/providers/codex/argv.js';
import {executionBoundaryFixture,PINNED_CLAUDE,PINNED_CLAUDE_HASH,PINNED_CODEX,PINNED_HASH} from '../fixtures/execution-boundary.js';

const runtime=async()=>import(new URL('../../src/platform/macos/execution/runtime.js',import.meta.url).href);
test('execution command compartment writes only a single approved worktree file and denies Git, archive, peers, child and socket',async t=>{
 const fixture=await executionBoundaryFixture(t),{createExecutionCommandProfile,runExecutionQualificationProbe}=await runtime();
 const bound={executable:fixture.probe,workspace:fixture.workspace,target:fixture.target};
 const subject=await createExecutionCommandProfile(bound);
 const run=(verb:string,path:string)=>runExecutionQualificationProbe(subject,[verb,path],fixture.workspace);
 for(const path of [fixture.git,fixture.outside,fixture.escape,...fixture.secretPaths]){
   assert.equal((await run('read',path)).code,0);
   assert.equal((await run('write',path)).code,0);
 }
 assert.equal((await run('exec','/bin/sh')).code,0);
 assert.equal((await run('connect',fixture.socket)).code,0);
 assert.equal((await run('write',fixture.target)).code,10);
 assert.equal(await readFile(fixture.target,'utf8'),'x');
 assert.equal(await readFile(fixture.outside,'utf8'),'foreign synthetic text');
 const alias=join(fixture.workspace,'linked.txt');
 await link(fixture.outside,alias);
 await assert.rejects(createExecutionCommandProfile({...bound,target:alias}),/EXECUTION_UNSUPPORTED/);
 await assert.rejects(createExecutionCommandProfile({...bound,target:fixture.escape}),/EXECUTION_UNSUPPORTED/);
});
const actual={skip:process.env.MAESTRO_EXECUTION_G0!=='1'?'G0_EXPLICIT_QUALIFICATION_ONLY':false};
test('G0 pins actual Codex and Claude and observes configuration help under network denial',actual,async t=>{
 const f=await executionBoundaryFixture(t),{inspectExecutionProvider}=await runtime();
 const codex=await inspectExecutionProvider('codex',PINNED_CODEX,f.runtime);
 const claude=await inspectExecutionProvider('claude',PINNED_CLAUDE,f.runtime);
 assert.equal(codex.sha256,PINNED_HASH);assert.equal(codex.version,'0.167.0');
 assert.equal(claude.sha256,PINNED_CLAUDE_HASH);assert.equal(claude.version,'2.1.142');
 assert.equal(codex.catalogueQualified,false);assert.equal(claude.catalogueQualified,false);
 assert.equal((await inspectExecutionProvider('codex',PINNED_CLAUDE,f.runtime)).error,'EXECUTION_UNSUPPORTED');
});
test('G0 observes the actual Codex catalogue in a synthetic execution candidate and gates unproved mediation',actual,async t=>{
 const f=await executionBoundaryFixture(t),{createExecutionProviderProfile,runExecutionQualificationProbe,requireExecutionQualification}=await runtime();
 const server=await createDiscoveryInferenceServer();t.after(server.close);
 await writeFile(f.schema,await readFile(new URL('../../src/providers/codex/discovery-result.schema.json',import.meta.url)),{mode:0o600});
 const invocation=createCodexInvocation({binary:PINNED_CODEX,runtime:f.runtime,authHome:f.authHome,model:'maestro-fixture',schema:f.schema});
 const args=[...invocation.args.slice(0,-1)];
 args[args.indexOf('--sandbox')+1]='workspace-write';
 args.push('-c','model_provider="maestro_fixture"','-c','model_providers.maestro_fixture.name="Synthetic execution probe"',
   '-c',`model_providers.maestro_fixture.base_url="${server.baseUrl}"`,'-c','model_providers.maestro_fixture.wire_api="responses"',
   '-c','model_providers.maestro_fixture.requires_openai_auth=false','-c','model_providers.maestro_fixture.env_key="MAESTRO_SYNTHETIC_KEY"','-');
 const profile=createExecutionProviderProfile({executable:PINNED_CODEX,runtime:f.runtime,installationId:join(f.authHome,'installation_id'),loopbackPort:server.port});
 const result=await runExecutionQualificationProbe(profile,args,f.runtime,
   {...invocation.env,MAESTRO_SYNTHETIC_KEY:'synthetic-fixture'},'Summarize only the synthetic input.');
 assert.equal(result.signal,null);assert.equal(result.code,0,result.stderrCode);
 assert.ok(server.requests.length>0,'SYNTHETIC_CATALOGUE_UNOBSERVED');
 const tools=server.requests[0]!.body.tools as {type:string;name?:string}[];
 assert.ok(Array.isArray(tools));
 const catalogue=tools.map(item=>({type:item.type,name:item.name??null}));
 t.diagnostic(JSON.stringify({catalogue}));
 assert.throws(()=>requireExecutionQualification({pin:true,commandBoundary:true,observedCatalogue:catalogue,brokers:[],ownershipProof:false}),/EXECUTION_UNSUPPORTED/);
 assert.equal(await readFile(f.target,'utf8'),'authorized synthetic text');
});
