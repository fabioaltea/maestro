import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir,lstat,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {makeDeadline,systemClock} from '../../src/ports/clock.js';
import {environmentBoundaryFixture,fixtureRegistry} from '../fixtures/environment-boundary.js';

const modulePath='../../src/platform/macos/environment/pnpm.js';
const deadline=()=>makeDeadline(systemClock,15000);

async function snapshot(directory:string):Promise<Record<string,string>>{
 const files:Record<string,string>={};
 async function walk(current:string){
   for(const entry of await readdir(current,{withFileTypes:true})){
     const path=join(current,entry.name);
     if(entry.isDirectory())await walk(path);
     else if(entry.isFile())files[path.slice(directory.length)]=(await readFile(path)).toString('base64');
   }
 }
 await walk(directory);return files;
}

test('G0 pins pnpm and frozen install isolates two writable trees on the shared content store',async t=>{
 const {createPnpmEnvironment}=await import(modulePath);
 const f=await environmentBoundaryFixture(t),one=await f.workspace('one'),two=await f.workspace('two'),adapter=createPnpmEnvironment();
 const pin=await adapter.qualification();
 assert.equal(pin.version,'9.4.0');
 assert.match(pin.distributionDigest,/^[a-f0-9]{64}$/);
 for(const workspace of [one,two]){
   const lock=await readFile(workspace.lockPath),manifest=await readFile(workspace.manifestPath);
   const result=await adapter.install(await workspace.scope(),deadline());
   assert.equal(result.outcome,'SUCCEEDED',JSON.stringify(result));
   assert.deepEqual(await readFile(workspace.lockPath),lock);assert.deepEqual(await readFile(workspace.manifestPath),manifest);
   await assert.rejects(lstat(join(workspace.path,'executed-script')),{code:'ENOENT'});
   await assert.rejects(lstat(join(workspace.path,'node_modules','maestro-env-fixture','executed-script')),{code:'ENOENT'});
 }
 assert.ok(f.registry.requests()>0);
 const store=await snapshot(f.stateRoot);
 assert.ok(Object.keys(store).length>0);
 await writeFile(one.contents,'workspace edit');
 assert.equal(await readFile(two.contents,'utf8'),'clean fixture\n');
 assert.deepEqual(await snapshot(f.stateRoot),store);
});

test('G0 rejects hook/config channels and stale lockfiles with frozen inputs',async t=>{
 const {createPnpmEnvironment}=await import(modulePath);
 const f=await environmentBoundaryFixture(t),one=await f.workspace('one'),two=await f.workspace('two'),three=await f.workspace('three');
 const adapter=createPnpmEnvironment();
 await writeFile(join(one.path,'.pnpmfile.cjs'),"require('node:fs').writeFileSync('executed-hook','wrong')");
 await writeFile(join(two.path,'.npmrc'),'ignore-scripts=false\npackage-import-method=hardlink\n');
 for(const workspace of [one,two])await assert.rejects(adapter.install(await workspace.scope(),deadline()),/CONFIG_UNSAFE/);
 await assert.rejects(lstat(join(one.path,'executed-hook')),{code:'ENOENT'});
 const changed=JSON.parse(await readFile(three.manifestPath,'utf8'));
 changed.dependencies['maestro-env-fixture']='2.0.0';await writeFile(three.manifestPath,JSON.stringify(changed));
 const lock=await readFile(three.lockPath),failed=await adapter.install(await three.scope(),deadline());
 assert.notEqual(failed.outcome,'SUCCEEDED');
 assert.deepEqual(await readFile(three.lockPath),lock);
});

test('G0 registry scope confines network and cancellation observes the only permitted process exit',async t=>{
 const {createPnpmEnvironment}=await import(modulePath),adapter=createPnpmEnvironment();
 const scoped=await environmentBoundaryFixture(t,true),foreign=await fixtureRegistry(t);
 const other=await scoped.workspace('other',foreign);
 try{
   const result=await adapter.install(await other.scope(),deadline());
   assert.notEqual(result.outcome,'SUCCEEDED');
 }catch(error){assert.match(String(error),/CONFIG_UNSAFE/);}
 assert.equal(foreign.requests(),0);
 assert.equal((await adapter.qualification()).descendants,'DENIED');
 const pending=await scoped.workspace('pending'),abort=new AbortController();
 const running=adapter.install(await pending.scope(),deadline(),abort.signal);
 await Promise.race([scoped.registry.requested,running.then(()=>assert.fail('install exited before registry became active'))]);
 abort.abort();
 const stopped=await running;
 assert.equal(stopped.outcome,'CANCELLED',JSON.stringify(stopped));
 assert.equal(stopped.exitVerified,true);
});
