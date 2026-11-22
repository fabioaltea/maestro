import {join} from 'node:path';
import {writeFile} from 'node:fs/promises';
import type {TestContext} from 'node:test';
import {createPnpmEnvironment} from '../../src/platform/macos/environment/pnpm.js';
import {environmentBoundaryFixture} from './environment-boundary.js';

export async function environmentAdapterFixture(t:TestContext,holdResponse=false){
 const fixture=await environmentBoundaryFixture(t,holdResponse);
 return{...fixture,adapter:createPnpmEnvironment()};
}

export async function hostileAmbientPnpmConfig(t:TestContext,directory:string){
 const config=join(directory,'ambient.npmrc'),hook=join(directory,'ambient-hook.cjs'),marker=join(directory,'ambient-hook-ran');
 await writeFile(config,`ignore-scripts=false\npackage-import-method=hardlink\nglobal-pnpmfile=${hook}\n`);
 await writeFile(hook,`require('node:fs').writeFileSync(${JSON.stringify(marker)},'wrong')`);
 const values={npm_config_userconfig:config,npm_config_ignore_pnpmfile:'false',npm_config_package_import_method:'hardlink'};
 const saved=Object.fromEntries(Object.keys(values).map(key=>[key,process.env[key]]));
 for(const [key,value] of Object.entries(values))process.env[key]=value;
 t.after(()=>{for(const [key,value] of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
 return marker;
}
