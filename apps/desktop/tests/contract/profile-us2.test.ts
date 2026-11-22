import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {validateRequest} from '../../src/shared/validation.ts';
import {buildCliArgs} from '../../src/main/core-cli.ts';
import {profileCliInput} from '../../src/main/profile-cli.ts';

test('native skill picker owns private path and the renderer supplies only scoped metadata',()=>{
 const fields={bridgeVersion:1,callId:randomUUID(),selectionEpoch:1};
 validateRequest('chooseProfileSkill',{...fields,scope:'PROJECT',projectId:randomUUID()});
 assert.throws(()=>validateRequest('chooseProfileSkill',{...fields,scope:'GLOBAL',source:'/tmp/raw'}));
 const command={namespace:'profile' as const,action:'skill.preview',archive:'/tmp/store',requestId:randomUUID(),
   params:{scope:'GLOBAL',source:'/tmp/natively-selected'}};
 assert.ok(!buildCliArgs(command).some(arg=>arg.includes('natively-selected')));
 assert.deepEqual(JSON.parse(profileCliInput(command)!),command.params);
});
