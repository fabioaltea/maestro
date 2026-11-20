import type {ExecutionCapabilityInspection,ExecutionProviderId,ExecutionQualificationPort} from '../../src/ports/execution.js';

export function executionQualificationFixture(initial:ExecutionCapabilityInspection){
 let observation=structuredClone(initial);
 const port:ExecutionQualificationPort={async inspect(providerId:ExecutionProviderId){
   if(providerId!==observation.providerId)throw new Error('EXECUTION_UNSUPPORTED');
   return structuredClone(observation);
 }};
 return{port,replace(value:ExecutionCapabilityInspection){observation=structuredClone(value);}};
}

import {spawn} from 'node:child_process';
import {codexExecutionInput,codexExecutionThread} from '../../src/providers/codex/execution.js';
import {createInterface} from 'node:readline';

/** Disposable JSONL protocol client. This fixture never reads an account or repository. */
export async function appServerFixture(input:{
 executable:string;args:readonly string[];cwd:string;env:NodeJS.ProcessEnv;tools:readonly string[];
 act(name:string,parameters:unknown):Promise<boolean>;
}){
 const child=spawn(input.executable,[...input.args],{cwd:input.cwd,env:input.env,shell:false,stdio:['pipe','pipe','ignore']});
 child.stdin.on('error',()=>{});
 const lines=createInterface({input:child.stdout});
 const replies=new Map<number,{resolve(value:any):void;reject(error:Error):void}>();
 let nextId=0,finish!:(value:string)=>void;
 const completed=new Promise<string>(resolve=>{finish=resolve;});
 let bytes=0;
 const authorizedCalls:string[]=[];
 function send(value:unknown){child.stdin.write(JSON.stringify(value)+'\n');}
 function request(method:string,params:unknown){
   const id=++nextId;
   return new Promise<any>((resolve,reject)=>{replies.set(id,{resolve,reject});send({id,method,params});});
 }
 function stop(reason:string){
   finish(reason);
   for(const reply of replies.values())reply.reject(new Error(reason));
   replies.clear();
 }
 const close=new Promise<{code:number|null;signal:string|null}>(resolve=>{
   child.once('error',()=>{stop('FIXTURE_SPAWN_FAILED');resolve({code:null,signal:null});});
   child.once('close',(code,signal)=>{stop('FIXTURE_EXITED');resolve({code,signal});});
 });
 const timer=setTimeout(()=>{stop('FIXTURE_DEADLINE');child.kill('SIGKILL');},8000);
 lines.on('line',line=>{
   bytes+=Buffer.byteLength(line);
   if(bytes>65536){stop('OUTPUT_LIMIT');child.kill('SIGKILL');return;}
   try{
     const value=JSON.parse(line);
     const waiting=replies.get(value.id);
     if(waiting&&value.method===undefined){
       replies.delete(value.id);
       if(value.error)waiting.reject(new Error('FIXTURE_PROTOCOL_ERROR'));else waiting.resolve(value.result);
       return;
     }
     if(value.method==='turn/completed'){finish(String(value.params?.turn?.status));return;}
     if(value.id===undefined)return;
     if(value.method!=='item/tool/call'){
       send({id:value.id,error:{code:-32601,message:'Fixture method denied'}});return;
     }
     const name=value.params?.tool;
     void (async()=>{
       const permitted=typeof name==='string'&&input.tools.includes(name)&&await input.act(name,value.params?.arguments);
       if(permitted)authorizedCalls.push(name);
       send({id:value.id,result:{success:permitted,contentItems:[{type:'inputText',text:permitted?'Fixture success':'Fixture denied'}]}});
     })().catch(()=>stop('FIXTURE_TOOL_FAILED'));
   }catch{stop('FIXTURE_PROTOCOL_ERROR');}
 });
 try{
   await request('initialize',{clientInfo:{name:'maestro_fixture',version:'0'},capabilities:{experimentalApi:true}});
   send({method:'initialized'});
   const started=await request('thread/start',codexExecutionThread({cwd:input.cwd,modelId:'maestro-fixture',
     tools:input.tools.map(name=>({name,description:'Fixed synthetic operation',inputSchema:{type:'object',properties:{},additionalProperties:false}}))}));
   await request('turn/start',{threadId:started.thread.id,input:codexExecutionInput(Buffer.from('Use only the compiled fixture operations.'))});
   const status=await completed;
   child.stdin.end();
   const exit=await close;
   return{status,authorizedCalls,exit};
 }finally{clearTimeout(timer);lines.close();child.stdin.end();if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await close;}}
}
