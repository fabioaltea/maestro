import type {ProfileRecord} from '../../ports/profile.js';

export function appliesProfileScope(record:ProfileRecord,projectId:string,profileId:string){
 return record.scope==='GLOBAL'||record.scope==='PROJECT'&&record.projectId===projectId||
   record.scope==='PROFILE'&&record.ownerProfileId===profileId&&(record.projectId===null||record.projectId===projectId);
}
export function requireSkillSelection<T extends ProfileRecord>(selected:T,alternatives:readonly ProfileRecord[],projectId:string,profileId:string):T{
 if(selected.kind!=='SKILL'||selected.state==='DISABLED'||!appliesProfileScope(selected,projectId,profileId))throw new Error('REQUIRED_SKILL_MISSING');
 const rank={GLOBAL:0,PROJECT:1,PROFILE:2};
 if(alternatives.some(candidate=>candidate.kind==='SKILL'&&candidate.alias===selected.alias&&candidate.state!=='DISABLED'&&
   appliesProfileScope(candidate,projectId,profileId)&&rank[candidate.scope]>rank[selected.scope]))throw new Error('PROFILE_CONFLICT');
 return selected;
}
