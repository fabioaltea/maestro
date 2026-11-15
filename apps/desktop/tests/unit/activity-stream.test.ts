import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { JsonLines, StreamFrames } from '../../src/main/activity-stream.ts';
import { encodeActivityCursor } from '../../src/shared/activity-contract.ts';
test('NDJSON preserves split UTF-8, accepts multiple bounded lines and rejects oversize/invalid tails',()=>{
 const frames:unknown[]=[];const lines=new JsonLines(v=>frames.push(v));const bytes=Buffer.from('{"word":"caffè"}\n');
 for(const byte of bytes)lines.feed(Buffer.from([byte]));assert.deepEqual(frames,[{word:'caffè'}]);lines.end();
 assert.throws(()=>new JsonLines(()=>{}).feed(Buffer.alloc(65537,97)));
 assert.throws(()=>new JsonLines(()=>{}).feed(Buffer.from([255,10])));
 const incomplete=new JsonLines(()=>{});incomplete.feed(Buffer.from('{'));assert.throws(()=>incomplete.end());
});
test('started event and closed frames bind identity and preserve strict received sequence',()=>{
 const storeId=randomUUID(),instanceId=randomUUID(),correlationId=randomUUID(),subscriptionId=randomUUID();
 const parser=new StreamFrames(storeId,encodeActivityCursor(storeId,'4'));
 const started={protocolVersion:1,kind:'subscription.started',storeId,instanceId,correlationId,subscriptionId,highWater:'4'};
 assert.equal(parser.decode(started).kind,'started');
 const event={protocolVersion:1,kind:'event',correlationId,subscriptionId,instanceId,event:{protocolVersion:1,storeId,eventId:randomUUID(),seq:'5',occurredAt:'2026-11-15T00:00:00Z',instanceId,operationId:null,type:'lifecycle.changed',payload:{from:'STARTING',to:'RUNNING'}},cursor:encodeActivityCursor(storeId,'5')};
 assert.equal(parser.decode(event).kind,'event');
 assert.throws(()=>parser.decode({...event,correlationId:randomUUID()}));
 assert.throws(()=>parser.decode({...event,event:{...event.event,seq:'7'},cursor:encodeActivityCursor(storeId,'7')}));
 assert.throws(()=>new StreamFrames(storeId).decode(event));
 assert.equal(parser.decode({protocolVersion:1,kind:'subscription.closed',subscriptionId,lastReceived:'5',cursor:encodeActivityCursor(storeId,'5'),error:{code:'SERVICE_UNREACHABLE'}}).kind,'closed');
 const failed=new StreamFrames(storeId);assert.equal(failed.decode({protocolVersion:1,result:'BLOCKED',error:{code:'CURSOR_EXPIRED'},data:{storeId,firstAvailable:'9',highWater:'10',nextAction:'reread-status'}}).kind,'closed');
});
