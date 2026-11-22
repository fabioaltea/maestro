import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, lstat, rm, writeFile, link, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SafeLog } from '../../src/main/safe-log.ts';
import { validateRequest } from '../../src/shared/validation.ts';
test('logging accepts only safe metadata, correlates operation UUID and rotates at two MiB per file',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'maestro-safe-log-'));try{
  const log=new SafeLog(join(dir,'logs'));const operationId=crypto.randomUUID();
  await log.write({code:'OK',action:'confirmAction',requestId:crypto.randomUUID(),operationId,outcome:'SUCCEEDED'});
  for(let i=0;i<12;i++)await log.write({code:'INVALID_INPUT',action:'context',requestId:crypto.randomUUID()});
  await assert.rejects(log.write({code:'SECRET_TOKEN'}));await assert.rejects(log.write({code:'OK',stderr:'SECRET_TOKEN'} as never));
  const path=join(dir,'logs/desktop.jsonl');assert.match(await readFile(path,'utf8'),new RegExp(operationId));
  // Fill with safe rows, not secrets, then cross the actual default 2 MiB boundary.
  const line=JSON.stringify({code:'OK',action:'context',requestId:crypto.randomUUID()})+'\n';
  await writeFile(path,line.repeat(Math.floor((2*1024*1024)/Buffer.byteLength(line))),{mode:0o600});
  await log.write({code:'OK',requestId:crypto.randomUUID()});await log.write({code:'OK',requestId:crypto.randomUUID()});
  assert.deepEqual((await readdir(join(dir,'logs'))).sort(),['desktop.jsonl','desktop.jsonl.1']);
  for(const name of await readdir(join(dir,'logs'))){const s=await lstat(join(dir,'logs',name));assert.ok(s.size<=2*1024*1024);assert.equal(s.mode&0o777,0o600);assert.doesNotMatch(await readFile(join(dir,'logs',name),'utf8'),/SECRET_TOKEN|stderr/);}
  await chmod(path,0o644);await assert.rejects(log.write({code:'OK'}));await chmod(path,0o600);await link(path,join(dir,'alias'));await assert.rejects(log.write({code:'OK'}));
 }finally{await rm(dir,{recursive:true});}
});
test('closed request schema rejects unknown large inputs before serializing them',()=>{
 const value={bridgeVersion:1,callId:crypto.randomUUID(),selectionEpoch:0,extra:'x'.repeat(1024*1024),toJSON(){throw new Error('SERIALIZED_UNTRUSTED');}};
 assert.throws(()=>validateRequest('context',value),/INVALID_INPUT/);
});
test('result metadata retains only the authoritative operation identity and safe outcome',async()=>{
 const { resultLogMetadata }=await import('../../src/main/safe-log.ts');const id=crypto.randomUUID();
 assert.deepEqual(resultLogMetadata({result:{requestId:id,outcome:'SUCCEEDED',error:null,data:{secret:'SECRET'}}}),{code:'OK',operationId:id,outcome:'SUCCEEDED'});
 assert.deepEqual(resultLogMetadata({error:{code:'SECRET'},requestId:'invalid',outcome:'SECRET'}),{code:'CLIENT_PROTOCOL_ERROR'});
});
test('small-cap repeated rotation keeps only two bounded files',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'maestro-log-rotation-'));try{
  const log=new SafeLog(join(dir,'logs'),256);for(let i=0;i<20;i++)await log.write({code:'OK',action:'status',durationMs:i});
  const files=await readdir(join(dir,'logs'));assert.ok(files.length<=2);for(const name of files)assert.ok((await lstat(join(dir,'logs',name))).size<=256);
 }finally{await rm(dir,{recursive:true});}
});
