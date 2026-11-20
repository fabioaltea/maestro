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
