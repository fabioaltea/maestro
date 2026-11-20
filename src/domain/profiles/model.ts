export const PROFILE_LIMITS=Object.freeze({profiles:100,skills:200,tools:100,enabledTools:50,skillBytes:65536,
 artifactBytes:262144,resolutionBytes:524288,skillRefs:20,toolRefs:10});
export const PROFILE_KINDS=['PROFILE','SKILL','TOOL'] as const;
export const PROFILE_SCOPES=['GLOBAL','PROJECT','PROFILE'] as const;
export const PROFILE_STATES=['DRAFT','REVIEWED','ENABLED','DISABLED'] as const;
export const PROFILE_GRANTED=['create','revise','disable','skill.import','skill.bind','tool.import','tool.enable'] as const;
export const PROFILE_OBSERVED=['resolve','skill.preview'] as const;
export type ProfileKind=typeof PROFILE_KINDS[number];
export type ProfileScope=typeof PROFILE_SCOPES[number];
export type ProfileState=typeof PROFILE_STATES[number];
export function profileTransition(kind:ProfileKind,state:ProfileState,action:'enable'|'disable'|'revise'){
 if(state==='DISABLED')throw new Error('INVALID_TRANSITION');
 if(action==='disable')return 'DISABLED';
 if(action==='enable'&&kind==='TOOL'&&state==='REVIEWED')return 'ENABLED';
 if(action==='revise'&&kind==='PROFILE'&&state==='ENABLED')return 'ENABLED';
 throw new Error('INVALID_TRANSITION');
}
