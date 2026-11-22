import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

test('skill scope and alias precedence require explicit more specific selection',async()=>{
 const {requireSkillSelection}=await import(new URL('../../src/domain/profiles/skills.js',import.meta.url).href);
 const projectId=randomUUID(),profileId=randomUUID(),entityId=randomUUID();
 const global={kind:'SKILL',scope:'GLOBAL',alias:'checks',projectId:null,ownerProfileId:null,state:'REVIEWED',entityId};
 const local={...global,scope:'PROJECT',projectId,entityId:randomUUID()};
 assert.equal(requireSkillSelection(global,[global],projectId,profileId),global);
 assert.throws(()=>requireSkillSelection(global,[global,local],projectId,profileId),/PROFILE_CONFLICT/);
 assert.equal(requireSkillSelection(local,[global,local],projectId,profileId),local);
 assert.throws(()=>requireSkillSelection({...local,state:'DISABLED'},[global],projectId,profileId),/REQUIRED_SKILL_MISSING/);
});
