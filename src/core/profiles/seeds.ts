import type {ProfilePermission} from '../../domain/profiles/permissions.js';
import {parseProfileDocument} from '../../domain/profiles/resolve.js';

const roles=[
 ['project-architect','Project Architect','Esamina il contesto di progetto e formula domande o proposte.','WORKSPACE_READ'],
 ['frontend','Frontend','Implementa modifiche frontend nello scope del worktree approvato.','WORKSPACE_WRITE'],
 ['backend','Backend','Implementa modifiche backend nello scope del worktree approvato.','WORKSPACE_WRITE'],
 ['qa','QA','Verifica gli esiti tramite controlli registrati.','COMMAND_VALIDATE'],
 ['reviewer','Reviewer','Leggi gli snapshot e le prove e segnala le osservazioni.','WORKSPACE_READ'],
 ['release-manager','Release Manager','Prepara il piano di rilascio e registra i criteri.','WORKSPACE_READ'],
] as const;
export const PROFILE_SEEDS=roles.map(([alias,title,instructions,permission],index)=>{
 const counter=String(index+1).padStart(12,'0'),allow:ProfilePermission[]=permission==='WORKSPACE_READ'?['WORKSPACE_READ']:['WORKSPACE_READ',permission];
 return{entityId:`14afa030-b68e-43f8-bb01-${counter}`,revisionId:`14afa030-b68e-43f8-bb02-${counter}`,
   document:parseProfileDocument({alias,title,role:title,instructions,permissions:{allow,deny:[],required:[permission]}})};
});
