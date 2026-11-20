import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'node:test';
import {createCliHarness,invokeCli} from '../fixtures/cli-harness.js';

test('repository entry bootstraps explicitly, creates a local checkout and preserves operation identity',async t=>{
 const f=await createCliHarness(t);
 const call=async(action:string,path:string,id=randomUUID())=>{
   const reply=await invokeCli(['project',action,path,'--state-dir',f.archive,'--request-id',id,'--json']);
   return JSON.parse(reply.stdout);
 };
 const path=join(f.directory,'Nuovo repository'),id=randomUUID();
 const created=await call('create',path,id);
 assert.equal(created.outcome,'SUCCEEDED',JSON.stringify(created));
 assert.equal((await readFile(join(path,'.git','HEAD'),'utf8')).trim(),'ref: refs/heads/main');
 const repeated=await call('create',path,id);
 assert.equal(repeated.data.projectId,created.data.projectId);
 assert.equal((await call('open',path,id)).error.code,'IDEMPOTENCY_CONFLICT');
 const reopened=await call('open',path);
 assert.equal(reopened.data.projectId,created.data.projectId);
 const occupied=join(f.directory,'occupied');
 await mkdir(occupied);
 const work=join(occupied,'work.txt');
 await writeFile(work,'lavoro locale');
 assert.notEqual((await call('create',occupied)).outcome,'SUCCEEDED');
 assert.equal(await readFile(work,'utf8'),'lavoro locale');
 const query=await invokeCli(['project','operation',id,'--state-dir',f.archive,'--json']);
 assert.equal(JSON.parse(query.stdout).data.projectId,created.data.projectId);
});
