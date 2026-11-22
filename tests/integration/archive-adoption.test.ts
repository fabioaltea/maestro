import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {join} from 'node:path';
import {mkdir,readFile,rename,writeFile} from 'node:fs/promises';
import {promisify} from 'node:util';
import test from 'node:test';
import {cliFile,createCliHarness,invokeCli} from '../fixtures/cli-harness.js';

test('a stopped archive can become the private default without copying or changing its state',async t=>{
 const f=await createCliHarness(t),profile=join(f.directory,'profile');
 await mkdir(profile,{mode:0o700});
 const cli=async(...args:string[])=>{
   const result=await promisify(execFile)(process.execPath,[cliFile,...args],{env:{...process.env,HOME:profile},timeout:8000})
     .catch((error:{stdout:string})=>({stdout:error.stdout}));
   return JSON.parse(result.stdout);
 };
 assert.equal((await f.call('start')).code,0);
 const repo=join(f.directory,'existing');
 const registration=await invokeCli(['project','create',repo,'--state-dir',f.archive,'--json']);
 assert.equal(registration.code,0,registration.stdout);
 const original=JSON.parse(registration.stdout);
 assert.equal((await cli('archive','recover',f.archive)).code,'ARCHIVE_RECOVERY_BLOCKED');
 assert.equal((await f.call('stop')).code,0);
 const destination=join(profile,'Library','Application Support','Maestro','foundation','default');
 await mkdir(destination,{recursive:true,mode:0o700});
 const sentinel=join(destination,'state.sqlite');
 await writeFile(sentinel,'existing data',{mode:0o600});
 assert.equal((await cli('archive','recover',f.archive)).code,'ARCHIVE_RECOVERY_BLOCKED');
 assert.equal(await readFile(sentinel,'utf8'),'existing data');
 await rename(sentinel,join(destination,'preserved-test-data'));
 const database=join(f.archive,'state.sqlite'),before=await readFile(database);
 const adopted=await cli('archive','recover',f.archive);
 assert.equal(adopted.directory,f.archive,JSON.stringify(adopted));
 assert.deepEqual(await readFile(database),before);
 assert.deepEqual(await cli('archive','location'),{directory:f.archive});
 const history=await cli('project','operation',original.requestId,'--json');
 assert.equal(history.data.projectId,original.data.projectId);
 assert.equal(history.storeId,original.storeId);
 const moved=join(f.directory,'moved');
 await rename(f.archive,moved);
 try { assert.equal((await cli('archive','location')).code,'PERSISTENCE_UNAVAILABLE'); }
 finally { await rename(moved,f.archive); }
});
