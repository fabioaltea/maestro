import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,link,mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {appServerFixture} from '../fixtures/execution-adapter.js';
import {createDiscoveryInferenceServer} from '../fixtures/discovery-inference-server.js';
import {createProviderProfile as discoveryControlProfile} from '../../src/platform/macos/discovery/provider-profile.js';
import {syntheticProfileArgs} from '../fixtures/discovery-boundary.js';
import {createCodexInvocation} from '../../src/providers/codex/argv.js';
import {executionBoundaryFixture,fixtureExecutionBroker,PINNED_CLAUDE,PINNED_CLAUDE_HASH,PINNED_CODEX,PINNED_HASH} from '../fixtures/execution-boundary.js';

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
 assert.equal(claude.sha256,PINNED_CLAUDE_HASH);
 t.diagnostic(JSON.stringify({codex,claude}));
 assert.ok(claude.version==='2.1.142'||claude.error==='PROVIDER_UNSAFE');
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
 const profile=createExecutionProviderProfile({providerId:'codex',executable:PINNED_CODEX,runtime:f.runtime,installationId:join(f.authHome,'installation_id'),loopbackPort:server.port});
 const result=await runExecutionQualificationProbe(profile,args,f.runtime,
   {...invocation.env,MAESTRO_SYNTHETIC_KEY:'synthetic-fixture'},'Summarize only the synthetic input.');
 assert.equal(result.signal,null);
 const control=discoveryControlProfile({executable:PINNED_CODEX,runtime:f.runtime,authHome:f.authHome});
 const controlResult=await runExecutionQualificationProbe({executable:control.executable,
   args:[...await syntheticProfileArgs(control.args,f.directory,server.port),PINNED_CODEX]},args,f.runtime,
   {...invocation.env,MAESTRO_SYNTHETIC_KEY:'synthetic-fixture'},'Read only synthetic fixture metadata.');
 assert.equal(controlResult.signal,null);assert.equal(controlResult.code,0);
 assert.ok(server.requests.length>0,'SYNTHETIC_CATALOGUE_UNOBSERVED');
 const tools=server.requests.at(-1)!.body.tools as {type:string;name?:string}[];
 assert.ok(Array.isArray(tools));
 const catalogue=tools.map(item=>({type:item.type,name:item.name??null}));
 t.diagnostic(JSON.stringify({candidateExit:result.code,diagnostic:result.stderrCode,controlCatalogue:catalogue}));
 assert.throws(()=>requireExecutionQualification({pin:true,commandBoundary:true,observedCatalogue:catalogue,brokers:[],ownershipProof:true}),/EXECUTION_UNSUPPORTED/);
 assert.equal(await readFile(f.target,'utf8'),'authorized synthetic text');
});


test('G0 rejects the added MCP resource surface even when the broker lists scoped tools',actual,async t=>{
 const f=await executionBoundaryFixture(t),{createExecutionProviderProfile,runExecutionQualificationProbe,createExecutionCommandProfile}=await runtime();
 const bearer=randomUUID(),broker=fixtureExecutionBroker(bearer,async name=>{
   if(name==='scoped_write'){
     const invocation=await createExecutionCommandProfile({executable:f.probe,workspace:f.workspace,target:f.target});
     return (await runExecutionQualificationProbe(invocation,['write',f.target],f.workspace)).code===10;
   }
   return name==='approved_command'&&await readFile(f.target,'utf8')==='x';
 });
 const calls=['scoped_write','approved_command'].map((name,index)=>[{id:`fc_fixture_${index}`,type:'function_call',call_id:`call_${index}`,
   namespace:'mcp__maestro_fixture',name,arguments:'{}'}]);
 const server=await createDiscoveryInferenceServer(calls,broker.handle);t.after(server.close);
 await writeFile(f.schema,await readFile(new URL('../../src/providers/codex/discovery-result.schema.json',import.meta.url)),{mode:0o600});
 const invocation=createCodexInvocation({binary:PINNED_CODEX,runtime:f.runtime,authHome:f.authHome,model:'maestro-fixture',schema:f.schema});
 const args=[...invocation.args.slice(0,-1),'-c','model_provider="maestro_fixture"','-c','model_providers.maestro_fixture.name="Synthetic broker probe"',
   '-c',`model_providers.maestro_fixture.base_url="${server.baseUrl}"`,'-c','model_providers.maestro_fixture.wire_api="responses"',
   '-c','model_providers.maestro_fixture.requires_openai_auth=false','-c','model_providers.maestro_fixture.env_key="MAESTRO_SYNTHETIC_KEY"',
   '-c',`mcp_servers.maestro_fixture.url="http://127.0.0.1:${server.port}/mcp"`,'-c','mcp_servers.maestro_fixture.bearer_token_env_var="MAESTRO_SYNTHETIC_BROKER"',
   '-c','mcp_servers.maestro_fixture.required=true','-'];
 const profile=createExecutionProviderProfile({providerId:'codex',executable:PINNED_CODEX,runtime:f.runtime,installationId:join(f.authHome,'installation_id'),loopbackPort:server.port});
 const env={...invocation.env,MAESTRO_SYNTHETIC_KEY:'synthetic-fixture',MAESTRO_SYNTHETIC_BROKER:bearer};
 const candidate=await runExecutionQualificationProbe(profile,args,f.runtime,env,'Run only the declared fixture actions.');
 const candidateRequests=server.requests.length;
 const target=await readFile(f.target,'utf8');
 const candidateCatalogue=(server.requests[0]?.body.tools as {type:string;name?:string;tools?:{type:string;name:string}[]}[]|undefined)??[];
 const observed=candidateCatalogue.flatMap(item=>item.type==='namespace'?(item.tools??[]).map(tool=>({type:tool.type,name:`${item.name}.${tool.name}`})):
   [{type:item.type,name:item.name??null}]);
 const {requireExecutionQualification}=await runtime();
 const approved=[
   {type:'function',name:'mcp__maestro_fixture.scoped_write',operation:'SCOPED_WRITE'},
   {type:'function',name:'mcp__maestro_fixture.approved_command',operation:'APPROVED_COMMAND'},
   {type:'function',name:'request_user_input',operation:'QUESTION'},
 ];
 assert.equal(candidate.code,0);
 assert.ok(candidateRequests>=3);
 assert.ok(broker.observed.includes('tools/list'));
 assert.ok(observed.some(tool=>tool.name==='read_mcp_resource'));
 assert.throws(()=>requireExecutionQualification({pin:true,commandBoundary:true,observedCatalogue:observed,brokers:approved,ownershipProof:true}),/EXECUTION_UNSUPPORTED/);
 const control=discoveryControlProfile({executable:PINNED_CODEX,runtime:f.runtime,authHome:f.authHome});
 const comparison=await runExecutionQualificationProbe({executable:control.executable,
   args:[...await syntheticProfileArgs(control.args,f.directory,server.port),PINNED_CODEX]},args,f.runtime,env,'Run only the declared fixture actions.');
 const catalogue=(server.requests[candidateRequests]?.body.tools as {name?:string}[]|undefined)?.map(item=>item.name)??[];
 t.diagnostic(JSON.stringify({candidateExit:candidate.code,candidateRequests,comparisonExit:comparison.code,catalogue:observed,
   controlCatalogue:catalogue,brokerObserved:broker.observed,targetChanged:target==='x'}));
 assert.equal(candidate.signal,null);assert.equal(comparison.signal,null);
 assert.equal(await readFile(f.git,'utf8'),'gitdir: never-touch');
 assert.equal(await readFile(f.outside,'utf8'),'foreign synthetic text');
 assert.ok(candidateRequests===0||catalogue.every(name=>typeof name==='string'));
});


test('G0 actual Codex app-server mediates scoped synthetic writes and approved checks through a closed catalogue',actual,async t=>{
 const f=await executionBoundaryFixture(t),{createExecutionProviderProfile,createExecutionCommandProfile,runExecutionQualificationProbe,requireExecutionQualification}=await runtime();
 const toolNames=['scoped_write','approved_command'];
 const responses=toolNames.map((name,index)=>[{id:`fc_owned_${index}`,type:'function_call',call_id:`call_owned_${index}`,name,arguments:'{}'}]);
 const server=await createDiscoveryInferenceServer(responses);t.after(server.close);
 const auth=join(f.runtime,'scratch','app-server-home');
 await mkdir(auth,{mode:0o700});await writeFile(join(auth,'config.toml'),'# trusted synthetic config\n',{mode:0o600});
 const provider=createExecutionProviderProfile({providerId:'codex',executable:PINNED_CODEX,runtime:f.runtime,loopbackPort:server.port});
 const invocation=createCodexInvocation({binary:PINNED_CODEX,runtime:f.runtime,authHome:f.authHome,model:'maestro-fixture',schema:f.schema});
 const args=invocation.args.flatMap((value,index)=>value==='-c'?['-c',invocation.args[index+1]!]:[]);
 args.push('-c','model_provider="maestro_fixture"','-c','model_providers.maestro_fixture.name="Synthetic app-server probe"',
   '-c',`model_providers.maestro_fixture.base_url="${server.baseUrl}"`,'-c','model_providers.maestro_fixture.wire_api="responses"',
   '-c','model_providers.maestro_fixture.requires_openai_auth=false','-c','model_providers.maestro_fixture.env_key="MAESTRO_SYNTHETIC_KEY"',
   'app-server','--listen','stdio://');
 const command=await createExecutionCommandProfile({executable:f.probe,workspace:f.workspace,target:f.target}),before=await f.snapshot();
 const result=await appServerFixture({executable:provider.executable,args:[...provider.args,...args],cwd:f.runtime,
   env:{...invocation.env,CODEX_HOME:auth,MAESTRO_SYNTHETIC_KEY:'synthetic-fixture'},tools:toolNames,
   async act(name,parameters){
     if(!parameters||typeof parameters!=='object'||Array.isArray(parameters)||Object.keys(parameters).length)return false;
     if(name==='scoped_write')return (await runExecutionQualificationProbe(command,['write',f.target],f.workspace)).code===10;
     return name==='approved_command'&&(await runExecutionQualificationProbe(command,['read',f.target],f.workspace)).code===10;
   }});
 assert.equal(result.status,'completed');
 assert.deepEqual(result.authorizedCalls,toolNames);
 assert.deepEqual(result.exit,{code:0,signal:null});
 const catalog=(server.requests[0]!.body.tools as {name:string;type:string}[]).map(({name,type})=>({name,type}));
 assert.deepEqual(await f.snapshot(),before);
 assert.equal(await readFile(f.git,'utf8'),'gitdir: never-touch');
 assert.equal(await readFile(f.target,'utf8'),'x');
 requireExecutionQualification({pin:true,commandBoundary:true,observedCatalogue:catalog,ownershipProof:true,brokers:[
   {type:'function',name:'request_user_input',operation:'QUESTION'},
   {type:'function',name:'scoped_write',operation:'SCOPED_WRITE'},
   {type:'function',name:'approved_command',operation:'APPROVED_COMMAND'},
 ]});
 t.diagnostic(JSON.stringify({catalogue:catalog,providerExit:result.exit,authorizedCalls:result.authorizedCalls}));
});
