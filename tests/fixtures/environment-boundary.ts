import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {TestContext} from 'node:test';
import {createFilesystemIdentity} from '../../src/platform/macos/git/filesystem-identity.js';
import {createTestContext} from './test-context.js';

import {fixturePackage,fixtureVersion,fixtureLock,startFixtureRegistry} from './environment-registry.js';
export {fixturePackage,fixtureVersion} from './environment-registry.js';
import assert from 'node:assert/strict';

const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
export async function fixtureRegistry(t:TestContext,holdResponse=false){
 const registry=await startFixtureRegistry(holdResponse);
 t.after(()=>registry.close());
 return registry;
}
export async function environmentBoundaryFixture(t:TestContext,held=false){
 const context=await createTestContext(t);
 const registry=await fixtureRegistry(t,held);
 const identity=createFilesystemIdentity();
 const stateRoot=join(context.directory,'environment-store'),scratchRoot=join(context.directory,'scratch');
 await mkdir(stateRoot,{mode:0o700});await mkdir(scratchRoot,{mode:0o700});
 const store=await identity.capture(stateRoot,'directory');
 async function workspace(name:string,source=registry){
   assert.match(name,/^[a-z]+$/);
   const path=join(context.directory,name),scratchPath=join(scratchRoot,name);
   await mkdir(path,{mode:0o700});await mkdir(scratchPath,{mode:0o700});
   const lockPath=join(path,'pnpm-lock.yaml'),manifestPath=join(path,'package.json');
   await writeFile(manifestPath,JSON.stringify({name:'fixture-project',private:true,packageManager:`pnpm@${fixtureVersion}`,
     dependencies:{[fixturePackage]:'1.0.0'},scripts:{postinstall:'node ./forbidden.cjs'}},null,2)+'\n');
   await writeFile(join(path,'forbidden.cjs'),"require('node:fs').writeFileSync('executed-script','wrong')");
   await writeFile(lockPath,fixtureLock(source));
   const anchor=await identity.capture(path,'directory'),scratch=await identity.capture(scratchPath,'directory');
   async function scope(){return{workspace:anchor,store,scratch,registryOrigin:registry.origin,
     manifestDigest:hash(await readFile(manifestPath)),lockDigest:hash(await readFile(lockPath))};}
   return{path,lockPath,manifestPath,scope,contents:join(path,'node_modules',fixturePackage,'value.txt')};
 }
 return{workspace,registry,stateRoot};
}
