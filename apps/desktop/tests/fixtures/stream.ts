import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { TestContext } from 'node:test';
import { sanitizedEnvironment } from '../../src/main/runtime.ts';
import { encodeActivityCursor } from '../../src/shared/activity-contract.ts';
export function streamFrames(storeId=randomUUID(),after=0,count=1){
 const instanceId=randomUUID(),subscriptionId=randomUUID(),correlationId=randomUUID();
 const started={protocolVersion:1,kind:'subscription.started',storeId,instanceId,subscriptionId,correlationId,highWater:String(after+count)};
 const events=Array.from({length:count},(_,i)=>{const seq=String(after+i+1);return{protocolVersion:1,kind:'event',instanceId,subscriptionId,correlationId,event:{protocolVersion:1,storeId,instanceId,operationId:null,eventId:randomUUID(),seq,occurredAt:new Date().toISOString(),type:'lifecycle.changed',payload:{from:'STARTING',to:'RUNNING'}},cursor:encodeActivityCursor(storeId,seq)};});
 return{storeId,started,events,after:encodeActivityCursor(storeId,String(after))};
}
export async function scriptedRuntime(t:TestContext,frames:unknown[],options:{exit?:boolean;interval?:number}={}){
 const dir=await mkdtemp(join(tmpdir(),'maestro-stream-test-'));t.after(()=>rm(dir,{recursive:true}));
 const cli=join(dir,'fixture.mjs');
 await writeFile(cli,`const frames=${JSON.stringify(frames)};for(const f of frames){process.stdout.write(JSON.stringify(f)+'\\n');await new Promise(r=>setTimeout(r,${options.interval??10}));}${options.exit?'':'setInterval(()=>{},1000);'}`,{mode:0o600});
 return{node:process.execPath,cli,env:sanitizedEnvironment()};
}
export async function waitFor(check:()=>boolean,ms=5000){const end=performance.now()+ms;while(!check()){if(performance.now()>end)throw new Error('Condition timeout');await new Promise(r=>setTimeout(r,10));}}
