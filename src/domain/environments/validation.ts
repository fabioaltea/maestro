import {featureFields,featureObject,featureText} from '../features/bundle.js';
import {requireUuid} from '../identifiers.js';
import {ENVIRONMENT_LIMITS,type EnvironmentState} from './state.js';
import type {EnvironmentCommandSpec} from '../../ports/environment.js';

export const ENVIRONMENT_COMMAND_LIMIT=8;
export function readValidationCommands(manifest:Record<string,unknown>){
 try{
   const config=manifest.maestro===undefined?{}:featureObject(manifest.maestro);
   const commands=config.validation;
   if(commands===undefined)return [];
   if(!Array.isArray(commands)||commands.length>ENVIRONMENT_COMMAND_LIMIT)throw new Error('INVALID_REQUEST');
   const ids=new Set<string>();
   return commands.map(raw=>{
     const p=featureObject(raw);
     featureFields(p,['id','entry','argv','timeoutMs']);
     const id=requireUuid(p.id),entry=featureText(p.entry,80,true),timeoutMs=p.timeoutMs;
     if(ids.has(id)||!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,74}\.mjs$/.test(entry)||entry.includes('..')||
       !Array.isArray(p.argv)||p.argv.length>8||typeof timeoutMs!=='number'||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>ENVIRONMENT_LIMITS.jobMs)
       throw new Error('INVALID_REQUEST');
     const argv=p.argv.map(value=>featureText(value,256));
     ids.add(id);
     return{id,entry,argv,timeoutMs};
   });
 }catch{throw new Error('CONFIG_UNSAFE');}
}
export function requireEnvironmentValidation(input:{state:EnvironmentState;preparedDigest:string|null;inputDigest:string;
 expectedInputDigest:string;commandSpecId:string;commands:readonly EnvironmentCommandSpec[]}){
 if(input.state==='RECONCILING'||input.state==='PREPARING')throw new Error('JOB_RECONCILING');
 if(input.state!=='READY'||input.preparedDigest!==input.inputDigest||input.expectedInputDigest!==input.inputDigest)throw new Error('ENVIRONMENT_STALE');
 const spec=input.commands.find(command=>command.id===requireUuid(input.commandSpecId));
 if(!spec)throw new Error('INVALID_REQUEST');
 return spec;
}

export function mayCleanEnvironmentJob(scope:{verified:boolean;quiescent:boolean;hasLease:boolean;referenced:boolean}){
 return scope.verified&&scope.quiescent&&!scope.hasLease&&!scope.referenced;
}
