import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {validateRequest} from '../../src/shared/validation.ts';
import {validateProfileData} from '../../src/shared/profile-contract.ts';

test('desktop receives metadata-only tool and suggestion DTOs',()=>{
 const envelope={bridgeVersion:1,callId:randomUUID(),selectionEpoch:1};
 const params={action:'tool.enable',entityId:randomUUID(),revisionId:randomUUID(),stateRevision:'1',permissions:['TOOL_LOCAL']};
 validateRequest('prepareProfileAction',{...envelope,params});
 for(const extra of [{credential:'secret'},{endpoint:'http://example.invalid'},{argv:['--eval']}])
   assert.throws(()=>validateRequest('prepareProfileAction',{...envelope,params:{...params,...extra}}));
 const suggestion={entityId:randomUUID(),revisionId:randomUUID(),alias:'fixture',kind:'TOOL',reason:'PERMISSIONS_COMPATIBLE'};
 validateProfileData('suggest',{suggestions:[suggestion]});
 assert.throws(()=>validateProfileData('suggest',{suggestions:[{...suggestion,credential:'secret'}]}));
});
