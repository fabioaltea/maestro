import type {StoragePort} from '../../ports/storage.js';
import type {ArchivePaths} from '../../ports/platform.js';
import type {Deadline} from '../../ports/clock.js';
import type {ProfileImportPort} from '../../ports/profile.js';
import {PROFILE_READ_METHODS} from '../../protocol/profile.js';
import {createProfileImportReader} from '../../platform/macos/extensions/import-reader.js';
import {composeProfileServices} from './registry.js';
import {createProfileDispatch,type ProfileAction} from './dispatch.js';

export interface ProfileRuntimeContext{
 readonly storage:StoragePort;readonly paths:ArchivePaths;readonly instanceId:string;readonly source:ProfileImportPort;
}
export function createProfileRuntime(options:Omit<ProfileRuntimeContext,'source'>&{
 readonly native?:boolean;readonly importPort?:ProfileImportPort;readonly compose?:(context:ProfileRuntimeContext)=>Readonly<Record<string,ProfileAction>>;
}){
 let accepting=false;
 const pending=new Set<Promise<unknown>>();
 const actions:Record<string,ProfileAction>={};
 const source=options.importPort??createProfileImportReader();
 for(const [method,action] of Object.entries((options.compose??(options.native?composeProfileServices:undefined))?.({...options,source})??{})){
   actions[method]=async(params,peer)=>{
     if(!accepting)throw new Error('BLOCKED');
     if(pending.size>=8)throw new Error('BUSY');
     const result=action(params,peer);
     pending.add(result);
     try{return await result;}finally{pending.delete(result);}
   };
 }
 return{
   methods:[...PROFILE_READ_METHODS,...Object.keys(actions)],
   dispatch:createProfileDispatch(options.storage,actions),
   start(){accepting=true;},
   fence(){accepting=false;},
   async stop(deadline:Deadline){
     accepting=false;
     if(!pending.size)return;
     let timer:ReturnType<typeof setTimeout>|undefined;
     try{await Promise.race([Promise.allSettled([...pending]),new Promise<never>((_,reject)=>{
       timer=setTimeout(()=>reject(new Error('DEADLINE_EXCEEDED')),Math.max(1,deadline.remainingMs()));
     })]);}finally{clearTimeout(timer);}
   },
 };
}
