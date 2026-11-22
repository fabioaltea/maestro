import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {validateRequest} from '../../src/shared/validation.ts';
import {buildCliArgs} from '../../src/main/core-cli.ts';
import {profileCliInput} from '../../src/main/profile-cli.ts';
import {validateProfileData} from '../../src/shared/profile-contract.ts';

test('desktop profile mutations use guarded grant and stdin, with closed metadata DTOs',()=>{
 const request={bridgeVersion:1,callId:randomUUID(),selectionEpoch:1};
 const bundle={alias:'review',title:'Review',role:'QA',instructions:'Fixture private text'};
 const params={action:'create',scope:'GLOBAL',bundle};
 validateRequest('prepareProfileAction',{...request,params});
 assert.throws(()=>validateRequest('prepareProfileAction',{...request,params:{...params,grantId:randomUUID()}}));
 assert.throws(()=>validateRequest('prepareProfileAction',{...request,params:{...params,bundle:{...bundle,program:'/tmp/outside'}}}));
 const c={namespace:'profile' as const,action:'artifact.import',archive:'/tmp/state',requestId:randomUUID(),params:bundle};
 assert.ok(!buildCliArgs(c).join(' ').includes(bundle.instructions));
 assert.deepEqual(JSON.parse(profileCliInput(c)!),bundle);
 assert.throws(()=>validateProfileData('list',{items:[],privatePath:'/tmp/original'}));
});
