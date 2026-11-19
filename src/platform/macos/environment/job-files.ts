import {constants} from 'node:fs';
import {lstat,mkdir,open,opendir,realpath,statfs} from 'node:fs/promises';
import {dirname,isAbsolute,join,relative} from 'node:path';
import {requireUuid} from '../../../domain/identifiers.js';
import {ENVIRONMENT_LIMITS} from '../../../domain/environments/state.js';
import type {Deadline} from '../../../ports/clock.js';
import type {EnvironmentExitEvidence,EnvironmentInstallScope,EnvironmentJobIdentity} from '../../../ports/environment.js';
import type {ArchivePaths} from '../../../ports/platform.js';
import {createFilesystemIdentity} from '../git/filesystem-identity.js';
import {stableEnvironmentFile} from './pnpm.js';

const filesystem=createFilesystemIdentity();
const missing=(error:unknown)=>(error as NodeJS.ErrnoException).code==='ENOENT';
async function privateDirectory(path:string,create:boolean){
 if(create)try{await mkdir(path,{mode:0o700});}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
 const value=await lstat(path);
 if(!value.isDirectory()||value.uid!==process.getuid!()||(value.mode&0o777)!==0o700||await realpath(path)!==path)throw new Error('OWNERSHIP_UNPROVEN');
 return filesystem.capture(path,'directory');
}
export async function environmentJobDirectories(paths:ArchivePaths,identity:EnvironmentJobIdentity,create:boolean){
 requireUuid(identity.jobId);requireUuid(identity.generation);requireUuid(identity.leaseId);
 if(paths.ownerUid!==process.getuid!())throw new Error('UNAUTHORIZED');
 await privateDirectory(paths.directory,false);
 const root=join(paths.directory,'environment-data'),jobs=join(root,'jobs');
 await privateDirectory(root,create);await privateDirectory(jobs,create);
 const proofRoot=await privateDirectory(join(jobs,`${identity.jobId}.${identity.generation}`),create);
 const scratch=await privateDirectory(join(proofRoot.canonicalPath,'run'),create);
 return{proofRoot,scratch,store:await privateDirectory(join(root,'store'),create)};
}
export async function sealJobEvidence(proofRoot:EnvironmentInstallScope['scratch'],name:'launch.json'|'exit.json',value:EnvironmentJobIdentity|EnvironmentExitEvidence){
 const root=proofRoot.canonicalPath;
 if(filesystem.compare(proofRoot,await privateDirectory(root,false))!=='VERIFIED')throw new Error('OWNERSHIP_UNPROVEN');
 const path=join(root,name),file=await open(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
 try{await file.writeFile(JSON.stringify(value));await file.sync();}finally{await file.close();}
 const directory=await open(root,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
 try{await directory.sync();}finally{await directory.close();}
}
export async function readEnvironmentExit(paths:ArchivePaths,identity:EnvironmentJobIdentity){
 try{
   const {proofRoot}=await environmentJobDirectories(paths,identity,false),path=join(proofRoot.canonicalPath,'exit.json');
   const info=await lstat(path);
   if(!info.isFile()||info.nlink!==1||info.uid!==paths.ownerUid||(info.mode&0o777)!==0o600)return null;
   const proof=JSON.parse((await stableEnvironmentFile(path,4096)).toString('utf8')) as EnvironmentExitEvidence;
   if(proof.verified!==true||!['SUCCEEDED','FAILED','CANCELLED'].includes(proof.outcome)||
     proof.jobId!==identity.jobId||proof.generation!==identity.generation||proof.leaseId!==identity.leaseId)return null;
   return proof;
 }catch{return null;}
}

export async function checkEnvironmentDisk(scope:EnvironmentInstallScope,deadline:Deadline){
 const workspace=scope.workspace.canonicalPath,ownedRoot=dirname(workspace),store=scope.store.canonicalPath;
 const volume=await statfs(workspace,{bigint:true});
 if(volume.bavail*volume.bsize<BigInt(ENVIRONMENT_LIMITS.freeBytes))throw new Error('DISK_BUDGET');
 const repositoryParent=await lstat(ownedRoot);
 if(!repositoryParent.isDirectory()||repositoryParent.uid!==process.getuid!()||(repositoryParent.mode&0o077)!==0||await realpath(ownedRoot)!==ownedRoot)
   throw new Error('OWNERSHIP_UNPROVEN');
 let entries=0,total=0;
 async function measure(root:string,path:string):Promise<number>{
   if(++entries>200000||deadline.expired())throw new Error('DISK_BUDGET');
   let info;
   try{info=await lstat(path);}catch(error){if(missing(error))return 0;throw error;}
   if(info.isSymbolicLink()){
     let target;
     try{target=await realpath(path);}catch(error){if(missing(error))return 0;throw error;}
     const suffix=relative(root,target);
     if(isAbsolute(suffix)||suffix==='..'||suffix.startsWith('../'))throw new Error('CONFIG_UNSAFE');
     return 0;
   }
   if(info.isFile())return info.size;
   if(!info.isDirectory())throw new Error('CONFIG_UNSAFE');
   let bytes=0;
   for await(const entry of await opendir(path)){
     bytes+=await measure(root,join(path,entry.name));
     if(bytes>ENVIRONMENT_LIMITS.totalBytes)throw new Error('DISK_BUDGET');
   }
   return bytes;
 }
 const visited=new Set<string>();
 for await(const entry of await opendir(ownedRoot)){
   if(++entries>200000||deadline.expired())throw new Error('DISK_BUDGET');
   if(!entry.isDirectory())continue;
   try{requireUuid(entry.name);}catch{continue;}
   const modules=join(ownedRoot,entry.name,'node_modules');
   const size=await measure(modules,modules);
   if(size>ENVIRONMENT_LIMITS.workspaceBytes)throw new Error('DISK_BUDGET');
   total+=size;visited.add(modules);
 }
 const modules=join(workspace,'node_modules');
 if(!visited.has(modules)){
   const size=await measure(modules,modules);
   if(size>ENVIRONMENT_LIMITS.workspaceBytes)throw new Error('DISK_BUDGET');
   total+=size;
 }
 total+=await measure(store,store);
 if(total>ENVIRONMENT_LIMITS.totalBytes)throw new Error('DISK_BUDGET');
}
