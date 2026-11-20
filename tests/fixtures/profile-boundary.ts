import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {TestContext} from 'node:test';
import {createTestContext} from './test-context.js';

export async function profileBoundaryFixture(t:TestContext){
 const {directory}=await createTestContext(t);
 const source=join(directory,'fixture-skill');
 await mkdir(source,{mode:0o700});
 await writeFile(join(source,'SKILL.md'),'# Fixture\n\nText requests no new permissions.\n');
 await writeFile(join(source,'manifest.json'),JSON.stringify({alias:'fixture',files:[],requiredPermissions:[]}));
 return{source,directory};
}
