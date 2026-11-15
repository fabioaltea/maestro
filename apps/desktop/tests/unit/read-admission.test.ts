import test from 'node:test';
import assert from 'node:assert/strict';
import { ArchiveContext } from '../../src/main/archive-context.ts';
import { ArchiveReader } from '../../src/main/read-handlers.ts';
import { createScratch } from '../fixtures/desktop.ts';
import type { PublicResult } from '../../src/shared/bridge-contract.ts';
test('brief local read-slot contention retries only undispatched reads and remains bounded',async()=>{
 const f=await createScratch();try{
  const context=new ArchiveContext();await context.select(f.archive);let calls=0;
  const reader=new ArchiveReader(context,{async call(command){assert.equal(command.action,'status');calls++;if(calls<3)throw new Error('LOCAL_BUSY');return{protocolVersion:1,storeId:null,instanceId:null,requestId:null,result:'OK',outcome:null,freshness:'LAST_KNOWN',liveness:'ABSENT_VERIFIED',data:{},error:null} satisfies PublicResult;},close(){}});
  assert.equal((await reader.read('status')).liveness,'ABSENT_VERIFIED');assert.equal(calls,3);
  calls=0;const unavailable=new ArchiveReader(context,{async call(){calls++;throw new Error('LOCAL_BUSY');},close(){}});
  await assert.rejects(()=>unavailable.read('status'),{message:'LOCAL_BUSY'});assert.equal(calls,5);
 }finally{await f.cleanup();}
});
