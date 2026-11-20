import {createServer} from 'node:net';
import {mkdir,mkdtemp,realpath,rm,symlink,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createBoundaryFixture,compileBoundaryProbe,PINNED_CODEX,PINNED_HASH} from './discovery-boundary.js';
import type {TestContext} from 'node:test';

export {PINNED_CODEX,PINNED_HASH};
export const PINNED_CLAUDE='/Users/fabioaltea/.local/share/claude/versions/2.1.142';
export const PINNED_CLAUDE_HASH='772021afa051160b97e04d379738df84d4cacd311e8c199a325fb013b3eaa448';

export async function executionBoundaryFixture(t:TestContext){
 const f=await createBoundaryFixture();t.after(f.cleanup);
 const workspace=join(f.directory,'workspace'),other=join(f.directory,'other-workspace');
 const socketRoot=await realpath(await mkdtemp('/private/tmp/maestro-execution-probe-'));
 const socket=join(socketRoot,'endpoint');
 const server=createServer(client=>client.end());
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(socket,resolve);});
 t.after(async()=>{
   await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
   await rm(socketRoot,{recursive:true});
 });
 for(const path of [workspace,other])await mkdir(path,{mode:0o700});
 const target=join(workspace,'approved.txt'),outside=join(other,'unchanged.txt'),git=join(workspace,'.git'),escape=join(workspace,'escape');
 await writeFile(target,'authorized synthetic text',{mode:0o600});
 await writeFile(outside,'foreign synthetic text',{mode:0o600});
 await writeFile(git,'gitdir: never-touch',{mode:0o600});
 await symlink(f.secretPaths[0]!,escape);
 return{...f,workspace,other,target,outside,git,escape,socket,probe:await compileBoundaryProbe(f.directory)};
}

export function fixtureExecutionBroker(bearer:string,perform:(name:string)=>Promise<boolean>){
 const names=['scoped_write','approved_command'];
 const observed:string[]=[];
 return{observed,async handle(request:import('node:http').IncomingMessage,response:import('node:http').ServerResponse){
   if(request.url!=='/mcp')return false;
   if(request.headers.authorization!==`Bearer ${bearer}`){response.writeHead(401);response.end();return true;}
   if(request.method!=='POST'){response.writeHead(405);response.end();return true;}
   const chunks:Buffer[]=[];let bytes=0;
   for await(const chunk of request){
     bytes+=Buffer.byteLength(chunk);
     if(bytes>4096){response.writeHead(413);response.end();return true;}
     chunks.push(Buffer.from(chunk));
   }
   const message=JSON.parse(Buffer.concat(chunks).toString('utf8')) as {id?:number;method:string;params?:{protocolVersion?:string;name?:string;arguments?:Record<string,unknown>}};
   observed.push(message.method);
   if(message.id===undefined){response.writeHead(202);response.end();return true;}
   let result:unknown;
   if(message.method==='initialize')result={protocolVersion:message.params?.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'maestro_fixture',version:'1.0.0'}};
   else if(message.method==='tools/list')result={tools:names.map(name=>({name,description:'Fixed synthetic operation',inputSchema:{type:'object',properties:{},additionalProperties:false}}))};
   else if(message.method==='tools/call'){
     const {name,arguments:args}=message.params??{};
     const success=!!name&&names.includes(name)&&args&&Object.keys(args).length===0&&await perform(name);
     result={content:[{type:'text',text:success?'Fixture operation observed':'Fixture operation rejected'}],isError:!success};
   }else result={};
   response.writeHead(200,{'content-type':'application/json'});response.end(JSON.stringify({jsonrpc:'2.0',id:message.id,result}));
   return true;
 }};
}
