import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {lstat,mkdir,open,realpath,unlink} from 'node:fs/promises';
import {homedir} from 'node:os';
import {dirname,isAbsolute,join} from 'node:path';
import {requireUuid} from '../../../domain/identifiers.js';
import type {FilesystemAnchor} from '../../../ports/repository.js';
import type {OwnedWorkspaceFilesPort,WorkspaceClaim,WorkspaceMarker} from '../../../ports/workspace.js';
import {createFilesystemIdentity} from './filesystem-identity.js';
import {createOwnershipLease} from '../lease.js';

const filesystem=createFilesystemIdentity();
const hash=(value:Uint8Array)=>createHash('sha256').update(value).digest('hex');
const maxMarkerBytes=65536;
const missing=(error:unknown)=>(error as NodeJS.ErrnoException).code==='ENOENT';

async function safeDirectory(path:string,create:boolean){
 if(create)try{await mkdir(path,{mode:0o700});}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
 const info=await lstat(path);
 if(!info.isDirectory()||info.uid!==process.getuid!()||(info.mode&0o777)!==0o700||await realpath(path)!==path)throw new Error('OWNERSHIP_UNPROVEN');
 return filesystem.capture(path,'directory');
}
async function anchored(root:FilesystemAnchor){
 const actual=await safeDirectory(root.canonicalPath,false);
 if(filesystem.compare(root,actual)!=='VERIFIED')throw new Error('OWNERSHIP_UNPROVEN');
}
async function syncDirectory(path:string){
 const handle=await open(path,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
 try{await handle.sync();}finally{await handle.close();}
}
async function read(path:string){
 let handle;
 try{handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);}
 catch(error){if(missing(error))return null;throw new Error('OWNERSHIP_UNPROVEN');}
 try{
   const before=await handle.stat({bigint:true});
   if(!before.isFile()||before.uid!==BigInt(process.getuid!())||before.nlink!==1n||
     (before.mode&0o777n)!==0o600n||before.size>BigInt(maxMarkerBytes))throw new Error('OWNERSHIP_UNPROVEN');
   const bytes=Buffer.alloc(Number(before.size));
   for(let offset=0;offset<bytes.length;){
     const chunk=await handle.read(bytes,offset,bytes.length-offset,offset);
     if(!chunk.bytesRead)throw new Error('OWNERSHIP_UNPROVEN');
     offset+=chunk.bytesRead;
   }
   const after=await handle.stat({bigint:true});
   if(before.ctimeNs!==after.ctimeNs||before.mtimeNs!==after.mtimeNs||before.size!==after.size)throw new Error('OWNERSHIP_UNPROVEN');
   return bytes;
 }finally{await handle.close();}
}
async function seal(root:FilesystemAnchor,path:string,value:Uint8Array){
 if(value.length>maxMarkerBytes)throw new Error('RESOURCE_LIMIT');
 await anchored(root);
 try{
   const handle=await open(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
   try{await handle.writeFile(value);await handle.sync();}finally{await handle.close();}
 }catch(error){
   if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;
   if(!(await read(path))?.equals(value))throw new Error('WORKSPACE_IN_USE');
 }
 await anchored(root);
 await syncDirectory(root.canonicalPath);
}

export function createOwnedWorkspaceFiles(base=join(homedir(),'Library','Application Support','Maestro','workspaces')):OwnedWorkspaceFilesPort{
 const leases=createOwnershipLease();
 async function baseDirectory(){
   if(!isAbsolute(base))throw new Error('INVALID_REQUEST');
   if(base===join(homedir(),'Library','Application Support','Maestro','workspaces')){
     const parent=dirname(base);
     if(await realpath(dirname(parent))!==dirname(parent))throw new Error('OWNERSHIP_UNPROVEN');
     await safeDirectory(parent,true);
   }
   return safeDirectory(base,true);
 }
 async function claimLocation(intent:WorkspaceClaim){
   if(!/^[a-f0-9]{64}$/.test(intent.repositoryKey))throw new Error('INVALID_REQUEST');
   requireUuid(intent.storeId);requireUuid(intent.requestId);requireUuid(intent.ownerGeneration);
   const parent=await baseDirectory(),root=await safeDirectory(join(parent.canonicalPath,'repository-locks'),true);
   return{root,lock:join(root.canonicalPath,intent.repositoryKey+'.sqlite'),
     path:join(root.canonicalPath,intent.repositoryKey+'.claim'),bytes:Buffer.from(JSON.stringify(intent))};
 }
 async function settle(root:FilesystemAnchor,path:string,bytes:Buffer,allowMissing=false){
   await anchored(root);
   const existing=await read(path);
   if(!existing&&allowMissing)return;
   if(!existing?.equals(bytes))throw new Error('OWNERSHIP_UNPROVEN');
   await unlink(path);await syncDirectory(root.canonicalPath);
 }
 return{
   async root(storeId){
     const parent=await baseDirectory();await anchored(parent);
     return safeDirectory(join(parent.canonicalPath,requireUuid(storeId)),true);
   },
   async claim(intent){
     const {root,lock,path,bytes}=await claimLocation(intent);
     const lease=leases.tryAcquire(lock,'daemon');
     if(lease.status!=='HELD')throw new Error(lease.status==='BUSY'?'WORKSPACE_IN_USE':'OWNERSHIP_UNPROVEN');
     try{await seal(root,path,bytes);}catch(error){lease.handle.release();throw error;}
     let released=false;
     return{
       async settle(){
         if(released)throw new Error('OWNERSHIP_UNPROVEN');
         await settle(root,path,bytes);
       },
       release(){if(!released){released=true;lease.handle.release();}},
     };
   },
   async settleClaim(intent){
     const {root,lock,path,bytes}=await claimLocation(intent);
     if(!(await read(path))?.equals(bytes))return;
     const lease=leases.tryAcquireExisting(lock,'daemon');
     if(lease.status!=='HELD')throw new Error('WORKSPACE_IN_USE');
     try{await settle(root,path,bytes,true);}finally{lease.handle.release();}
   },
   async sealMarker(root,marker){
     const id=requireUuid(marker.workspaceId),bytes=Buffer.from(JSON.stringify(marker));
     await seal(root,join(root.canonicalPath,'.'+id+'.ownership'),bytes);
     return hash(bytes);
   },
   async readMarker(root,id){
     await anchored(root);
     const bytes=await read(join(root.canonicalPath,'.'+requireUuid(id)+'.ownership'));
     return bytes?{digest:hash(bytes),marker:JSON.parse(bytes.toString('utf8')) as WorkspaceMarker}:null;
   },
 };
}
