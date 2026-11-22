import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {lstat,open,readdir,realpath,statfs,writeFile} from 'node:fs/promises';
import {isAbsolute,join,relative} from 'node:path';
import type {Deadline} from '../../../ports/clock.js';
import {makeDeadline,systemClock} from '../../../ports/clock.js';
import type {EnvironmentInstallPort,EnvironmentInstallScope,EnvironmentManagerPin,EnvironmentInstallResult,EnvironmentValidationScope} from '../../../ports/environment.js';
import type {FilesystemAnchor} from '../../../ports/repository.js';
import {createFilesystemIdentity} from '../git/filesystem-identity.js';
import {environmentProfile,loopbackRule,sandboxEnvironmentArgs,sandboxValidationArgs,validationProfile} from './profile.js';

const distribution='/usr/local/lib/node_modules/pnpm';
const entry=join(distribution,'bin','pnpm.cjs');
const pnpmVersion='9.4.0',nodeVersion='26.13.0';
const distributionDigest='55627c40c52384b44eb80282dbfbf37a3af29a8de3472edbdf8e71b7737754bd';
const entryDigest='2651efc8bc13e7d797dc8bb88b552eb5d657c700381db9aee587fdea5c5888d5';
const nodeDigest='533bd644c5ae0e0ea3a80e433aad16b817447ccba1e1eea701875eac80cb75d4';
const filesystem=createFilesystemIdentity();
const digest=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
const profileDigest=digest(environmentProfile+'\0'+loopbackRule);
export const validationProfileDigest=digest(validationProfile);
const sandbox='/usr/bin/sandbox-exec';
const outputCap=65536;
const configFiles=['.npmrc','.pnpmfile.cjs','.pnpmfile.js','.pnpmfile.mjs','pnpm-workspace.yaml','pnpm-workspace.yml',
 'package-lock.json','npm-shrinkwrap.json','yarn.lock','bun.lock','bun.lockb'];
const installFlags=['--frozen-lockfile','--ignore-scripts','--ignore-pnpmfile','--config.package-import-method=clone-or-copy',
 '--config.side-effects-cache=false','--config.verify-store-integrity=true','--config.manage-package-manager-versions=false',
 '--config.fetch-retries=0','--config.fetch-timeout=10000','--config.update-notifier=false','--config.userconfig=/dev/null','--config.globalconfig=/dev/null',
 '--reporter=append-only'];

const isMissing=(error:unknown)=>(error as NodeJS.ErrnoException).code==='ENOENT';
async function optionalInfo(path:string){try{return await lstat(path,{bigint:true});}catch(error){if(isMissing(error))return null;throw error;}}
function contained(root:string,path:string){const tail=relative(root,path);return !isAbsolute(tail)&&tail!=='..'&&!tail.startsWith('../');}
async function anchor(expected:FilesystemAnchor,privateDirectory:boolean){
 const info=await optionalInfo(expected.canonicalPath);
 if(!info?.isDirectory()||info.uid!==BigInt(process.getuid!())||(info.mode&(privateDirectory?0o077n:0o022n))!==0n||
   filesystem.compare(expected,await filesystem.capture(expected.canonicalPath,'directory'))!=='VERIFIED')throw new Error('OWNERSHIP_UNPROVEN');
}

export async function stableEnvironmentFile(path:string,maximum:number){
 const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{
   const before=await file.stat({bigint:true});
   if(!before.isFile()||before.nlink!==1n||before.size>BigInt(maximum))throw new Error('CONFIG_UNSAFE');
   const content=Buffer.alloc(Number(before.size));
   for(let offset=0;offset<content.length;){
     const next=await file.read(content,offset,content.length-offset,offset);
     if(!next.bytesRead)throw new Error('CONFIG_UNSAFE');
     offset+=next.bytesRead;
   }
   const after=await file.stat({bigint:true});
   if(before.ctimeNs!==after.ctimeNs||before.mtimeNs!==after.mtimeNs||before.size!==after.size)throw new Error('CONFIG_UNSAFE');
   return content;
 }finally{await file.close();}
}
async function hashNode(path:string){
 const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW),hash=createHash('sha256');
 try{
   const before=await file.stat({bigint:true});
   if(!before.isFile()||(before.mode&0o022n)!==0n||before.size>180000000n)throw new Error('MANAGER_MISMATCH');
   for await(const chunk of file.createReadStream({autoClose:false}))hash.update(chunk);
   const after=await file.stat({bigint:true});
   if(before.ctimeNs!==after.ctimeNs||before.mtimeNs!==after.mtimeNs||before.size!==after.size)throw new Error('MANAGER_MISMATCH');
   return hash.digest('hex');
 }finally{await file.close();}
}
async function pinDistribution(){
 if(await realpath(distribution)!==distribution)throw new Error('MANAGER_MISMATCH');
 const entries:{name:string;hash:string}[]=[];
 let totalBytes=0;
 async function walk(directory:string,depth:number){
   if(depth>12)throw new Error('MANAGER_MISMATCH');
   for(const item of await readdir(directory,{withFileTypes:true})){
     const path=join(directory,item.name);
     if(item.isDirectory()){await walk(path,depth+1);continue;}
     if(!item.isFile()||entries.length>=1024||!item.name.isWellFormed())throw new Error('MANAGER_MISMATCH');
     const bytes=await stableEnvironmentFile(path,16*1024*1024);
     totalBytes+=bytes.length;
     if(totalBytes>32*1024*1024)throw new Error('MANAGER_MISMATCH');
     entries.push({name:relative(distribution,path),hash:digest(bytes)});
   }
 }
 await walk(distribution,0);
 const sorted=entries.sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);
 if(digest(sorted.map(e=>`${e.name}\0${e.hash}\n`).join(''))!==distributionDigest||
   sorted.find(e=>e.name==='bin/pnpm.cjs')?.hash!==entryDigest)throw new Error('MANAGER_MISMATCH');
}

function env(scratch:string){
 return{PATH:'/usr/bin:/bin',HOME:scratch,XDG_CONFIG_HOME:scratch,XDG_DATA_HOME:scratch,XDG_CACHE_HOME:scratch,PNPM_HOME:scratch,
   TMPDIR:scratch,LANG:'C',LC_ALL:'C',CI:'true',NO_UPDATE_NOTIFIER:'1',PNPM_DISABLE_SELF_UPDATE_CHECK:'1'};
}
function run(args:string[],cwd:string,scratch:string,deadline:Deadline,signal?:AbortSignal){
 return new Promise<{code:number|null;signal:NodeJS.Signals|null;reason:string|null;stdout:string;stderr:string;bytes:number}>((resolve,reject)=>{
   if(deadline.expired())return reject(new Error('DEADLINE_EXCEEDED'));
   const child=spawn(sandbox,args,{cwd,env:env(scratch),shell:false,stdio:['ignore','pipe','pipe']});
   let bytes=0,reason:string|null=null,killTimer:ReturnType<typeof setTimeout>|undefined;
   const output:Buffer[]=[],errors:Buffer[]=[];
   function stop(code:string){
     if(reason!==null)return;
     reason=code;
     child.kill('SIGTERM');
     killTimer=setTimeout(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');},500);
   }
   const abort=()=>stop('CANCELLED'),timer=setTimeout(()=>stop('DEADLINE_EXCEEDED'),Math.max(1,Math.floor(deadline.remainingMs())));
   signal?.addEventListener('abort',abort,{once:true});
   if(signal?.aborted)abort();
   function capture(target:Buffer[],chunk:Buffer){
     bytes+=chunk.length;
     if(bytes<=outputCap)target.push(chunk);else stop('OUTPUT_LIMIT');
   }
   child.stdout.on('data',(chunk:Buffer)=>capture(output,chunk));
   child.stderr.on('data',(chunk:Buffer)=>capture(errors,chunk));
   function cleanup(){clearTimeout(timer);clearTimeout(killTimer);signal?.removeEventListener('abort',abort);}
   child.once('error',()=>{cleanup();reject(new Error('MANAGER_UNSUPPORTED'));});
   child.once('close',(code,terminated)=>{cleanup();resolve({code,signal:terminated,reason,stdout:Buffer.concat(output).toString('utf8'),
     stderr:Buffer.concat(errors).toString('utf8'),bytes:Math.min(bytes,outputCap)});});
 });
}

function registry(origin:string|null){
 if(origin===null)return null;
 if(!/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(origin))throw new Error('CONFIG_UNSAFE');
 const address=new URL(origin);
 return{endpoint:`localhost:${address.port}`,origin:address.origin};
}
async function verifyInputs(scope:EnvironmentInstallScope){
 const workspace=scope.workspace.canonicalPath,store=scope.store.canonicalPath,scratch=scope.scratch.canonicalPath;
 await Promise.all([anchor(scope.workspace,false),anchor(scope.store,true),anchor(scope.scratch,true)]);
 const roots=[workspace,store,scratch];
 if(roots.some((path,i)=>roots.some((other,j)=>i!==j&&contained(path,other))))throw new Error('OWNERSHIP_UNPROVEN');
 const modules=join(workspace,'node_modules'),moduleInfo=await optionalInfo(modules);
 if(moduleInfo&&(!moduleInfo.isDirectory()||moduleInfo.uid!==BigInt(process.getuid!())))throw new Error('OWNERSHIP_UNPROVEN');
 for(const name of configFiles)if(await optionalInfo(join(workspace,name)))throw new Error('CONFIG_UNSAFE');
 const [manifest,lock]=await Promise.all([stableEnvironmentFile(join(workspace,'package.json'),1024*1024),stableEnvironmentFile(join(workspace,'pnpm-lock.yaml'),1024*1024)]);
 if(digest(manifest)!==scope.manifestDigest||digest(lock)!==scope.lockDigest)throw new Error('ENVIRONMENT_STALE');
 const declared=JSON.parse(manifest.toString('utf8')).packageManager;
 if(declared!==`pnpm@${pnpmVersion}`&&(declared!==undefined||scope.selectedVersion!==pnpmVersion))throw new Error('MANAGER_MISMATCH');
 const remote=registry(scope.registryOrigin);
 for(const url of lock.toString('utf8').match(/https?:\/\/[^\s,}'"]+/g)??[]){
   if(!remote||new URL(url).origin!==remote.origin)throw new Error('CONFIG_UNSAFE');
 }
 return{workspace,store,scratch,modules,remote};
}

async function selectedNode(verifyDistribution=true){
 if(process.platform!=='darwin'||process.arch!=='arm64'||process.versions.node!==nodeVersion)throw new Error('MANAGER_UNSUPPORTED');
 try{
   const node=await realpath(process.execPath);
   if(await hashNode(node)!==nodeDigest)throw new Error('MANAGER_MISMATCH');
   if(verifyDistribution)await pinDistribution();
   return node;
 }catch(error){if(isMissing(error))throw new Error('MANAGER_UNSUPPORTED');throw error;}
}

export async function runEnvironmentValidation(scope:EnvironmentValidationScope,deadline:Deadline,signal:AbortSignal):Promise<EnvironmentInstallResult>{
 if(signal.aborted)return{outcome:'CANCELLED',exitVerified:true,exitCode:null,error:'CANCELLED',bytes:0};
 const {command}=scope,workspace=scope.workspace.canonicalPath,scratch=scope.scratch.canonicalPath;
 if(!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,74}\.mjs$/.test(command.entry)||command.entry.includes('..'))throw new Error('CONFIG_UNSAFE');
 await Promise.all([anchor(scope.workspace,false),anchor(scope.scratch,true)]);
 if(contained(workspace,scratch)||contained(scratch,workspace))throw new Error('OWNERSHIP_UNPROVEN');
 if(scope.nodeDigest!==nodeDigest||scope.profileDigest!==validationProfileDigest)throw new Error('MANAGER_MISMATCH');
 const node=await selectedNode(false),source=await stableEnvironmentFile(join(workspace,command.entry),1048576);
 if(digest(source)!==command.sha256)throw new Error('ENVIRONMENT_STALE');
 const script=join(scratch,'input.mjs');
 await writeFile(script,source,{flag:'wx',mode:0o400});
 if(deadline.expired())throw new Error('DEADLINE_EXCEEDED');
 const args=sandboxValidationArgs(node,workspace,script);
 const result=await run([...args,'--',script,...command.argv],workspace,scratch,
   makeDeadline(systemClock,Math.max(1,Math.min(command.timeoutMs,deadline.remainingMs()))),signal);
 const error=result.reason??(result.code===0?null:'VALIDATION_FAILED');
 return{outcome:error==='CANCELLED'?'CANCELLED':error?'FAILED':'SUCCEEDED',exitVerified:true,exitCode:result.code,error,bytes:result.bytes};
}

export function createPnpmEnvironment():EnvironmentInstallPort{
 const pin:EnvironmentManagerPin={manager:'pnpm',version:pnpmVersion,nodeVersion,entryDigest,distributionDigest,nodeDigest,profileDigest,
   descendants:'DENIED',importMethod:'clone-or-copy'};
 async function qualification():Promise<EnvironmentManagerPin>{
   const node=await selectedNode(),deadline=makeDeadline(systemClock,10000),empty='/var/empty';
   const args=sandboxEnvironmentArgs({node,distribution,workspace:empty,store:empty,scratch:empty,modules:join(empty,'node_modules')});
   const version=await run([...args,entry,'--version'],'/',empty,deadline);
   if(version.code!==0||version.stdout.trim()!==pnpmVersion||version.stderr)throw new Error('MANAGER_MISMATCH');
   // A fixed process probe is executed under the same no-fork profile.
   const probe="const r=require('node:child_process').spawnSync(process.execPath,['--version']); if (!r.error || !['EPERM','EACCES'].includes(r.error.code)) process.exitCode=1";
   const child=await run([...args,'-e',probe],'/',empty,deadline);
   if(child.code!==0||child.stderr)throw new Error('MANAGER_UNSUPPORTED');
   return pin;
 }
 return{async configuredPin(){await selectedNode();return pin;},qualification,async install(scope,deadline,signal){
   if(signal?.aborted)return{outcome:'CANCELLED',exitVerified:true,exitCode:null,error:'CANCELLED',bytes:0};
   const paths=await verifyInputs(scope),node=await selectedNode();
   for(const root of [paths.workspace,paths.store]){
     const fs=await statfs(root,{bigint:true});
     if(fs.bavail*fs.bsize<2147483648n)throw new Error('DISK_BUDGET');
   }
   const args=sandboxEnvironmentArgs({node,distribution,...paths},paths.remote?.endpoint);
   const result=await run([...args,entry,'install',...installFlags,`--store-dir=${paths.store}`,
     `--virtual-store-dir=${join(paths.modules,'.pnpm')}`,
     ...(paths.remote?[`--registry=${paths.remote.origin}`]:['--offline'])],paths.workspace,paths.scratch,deadline,signal);
   await verifyInputs(scope);
   if(result.reason==='CANCELLED')return{outcome:'CANCELLED',exitVerified:true,exitCode:result.code,error:'CANCELLED',bytes:result.bytes};
   const error=result.reason??(result.code===0?'':/ERR_PNPM_(?:OUTDATED_LOCKFILE|FROZEN_LOCKFILE)/.test(result.stdout+result.stderr)?'LOCKFILE_CHANGED':'INSTALL_FAILED');
   return{outcome:error?'FAILED':'SUCCEEDED',exitVerified:true,exitCode:result.code,error:error||null,bytes:result.bytes};
 }};
}
