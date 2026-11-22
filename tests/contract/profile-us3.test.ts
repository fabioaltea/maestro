import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {validateProfileParams} from '../../src/protocol/profile.js';

test('tool import and enable reject raw endpoint, executable, credentials and extra authority',()=>{
 const intent={toolId:randomUUID(),revisionId:randomUUID(),permissions:['TOOL_LOCAL']};
 const prep={action:'tool.enable',intent,expectedRevisions:{stateRevision:'1'}};
 validateProfileParams('profile.prepare',prep);
 for(const extra of [{endpoint:'http://localhost'},{argv:['sh']},{credentialRef:'secret'},{approved:true}])
   assert.throws(()=>validateProfileParams('profile.prepare',{...prep,intent:{...intent,...extra}}),/INVALID_REQUEST/);
 assert.throws(()=>validateProfileParams('profile.tool.import',{requestId:randomUUID(),manifestArtifactId:randomUUID()}),/INVALID_REQUEST/);
});

test('headless suggestions without the live composed capability have a safe error',async t=>{
 const {spawnSync}=await import('node:child_process');
 const {createRegistryStore}=await import('../fixtures/registry-store.js');
 const fixture=await createRegistryStore(t);
 const result=spawnSync(process.execPath,['dist/cli/main.js','profile','suggest',randomUUID(),'--project',randomUUID(),'--state-dir',fixture.directory,'--json'],{encoding:'utf8'});
 assert.equal(JSON.parse(result.stdout).error.code,'DAEMON_UNAVAILABLE');
});
