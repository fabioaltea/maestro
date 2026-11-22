import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { ActivityStream } from '../../src/main/activity-stream.ts';
import { ActivityHistory } from '../../src/main/activity-history.ts';
import { ArchiveContext } from '../../src/main/archive-context.ts';
import { CoreCli } from '../../src/main/core-cli.ts';
import { validateRuntime } from '../../src/main/runtime.ts';
import { record } from '../../src/shared/validation.ts';
import { decodeHistoryPage, decodeActivityCursor } from '../../src/shared/activity-contract.ts';
import type { ActivityMessage } from '../../src/shared/bridge-contract.ts';
import { createScratch, repositoryRoot } from '../fixtures/desktop.ts';
export async function until(check:()=>boolean,ms=5000){const end=performance.now()+ms;while(!check()){if(performance.now()>end)throw new Error('Condition timeout');await new Promise(r=>setTimeout(r,10));}}
test('real history to live is contiguous, only ACK advances applied cursor, closing client preserves daemon',async()=>{
 const f=await createScratch(),runtime=await validateRuntime(process.execPath,join(repositoryRoot,'dist/cli/main.js')),core=new CoreCli(runtime);let stream:ActivityStream|undefined;
 try{
  await f.cli(['daemon','start']);const context=new ArchiveContext();await context.select(f.archive);
  const result=await new ActivityHistory(context,core).history(),page=decodeHistoryPage(result.data.events,result.storeId!);
  const messages:ActivityMessage[]=[];
  stream=new ActivityStream({runtime,archive:f.archive,storeId:result.storeId!,epoch:1,after:page.cursor,onMessage:m=>messages.push(m)});await stream.start();
  const repo=await f.repository('live-events');await f.cli(['project','add',repo.path]);
  await until(()=>messages.some(m=>m.kind==='activity.batch'));
  assert.equal(stream.lastAppliedCursor,page.cursor);
  let seq=BigInt(page.nextAfter);const ids=new Set(page.records.map(e=>e.eventId));let count=0;
  for(let turns=0;turns<30;turns++){
   const batch=messages.find(m=>m.kind==='activity.batch'&&!m.testConsumed);if(!batch){await new Promise(r=>setTimeout(r,30));continue;}
   batch.testConsumed=true;const events=batch.events as {seq:string;eventId:string}[];
   for(const event of events){assert.equal(BigInt(event.seq),++seq);assert.equal(ids.has(event.eventId),false);ids.add(event.eventId);count++;}
   stream.ack(String(batch.batchId),events.at(-1)!.seq);assert.equal(decodeActivityCursor(stream.lastAppliedCursor).seq,seq.toString());
  }
  assert.ok(count>=2);await stream.close();assert.equal((await f.cli(['daemon','status'])).result.liveness,'LIVE_VERIFIED');
 }finally{await stream?.close();core.close();await f.cleanup();}
});
