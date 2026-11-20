import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {lstat,open,realpath} from 'node:fs/promises';
import {findPackageJSON} from 'node:module';
import {basename,isAbsolute,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import type {ProfileImportPort,ProfileSource} from '../../../ports/profile.js';

const entry=fileURLToPath(import.meta.url),execute=promisify(execFile);
const sha=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
const fingerprint=(st:Awaited<ReturnType<import('node:fs/promises').FileHandle['stat']>>|import('node:fs').BigIntStats)=>
 [st.dev,st.ino,st.uid,st.mode,st.nlink,st.size].join(':');
export const profileImportPolicy=`(version 1)
(deny default)
(allow sysctl-read)
(allow process-exec (literal (param "NODE")))
(allow file-read-metadata)
(allow file-read-data (literal "/") (subpath "/System") (subpath "/usr/lib") (literal "/dev/null")
  (literal (param "NODE")) (literal (param "ENTRY")) (literal (param "PACKAGE")) (subpath (param "SOURCE")))
`;
const fail=()=>new Error('EXTENSION_UNTRUSTED');
async function scopedFile(root:string,path:string,maximum:number){
 const resolved=join(root,path);
 if(await realpath(resolved)!==resolved)throw fail();
 const fd=await open(resolved,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{
   const before=await fd.stat({bigint:true});
   if(!before.isFile()||before.nlink!==1n||before.uid!==BigInt(process.getuid!())||(before.mode&0o133n)!==0n)throw fail();
   if(before.size>BigInt(maximum))throw new Error('RESOURCE_LIMIT');
   const bytes=Buffer.alloc(Number(before.size));
   for(let offset=0;offset<bytes.length;){
     const chunk=await fd.read(bytes,offset,bytes.length-offset,offset);
     if(!chunk.bytesRead)throw fail();
     offset+=chunk.bytesRead;
   }
   const after=await fd.stat({bigint:true}),pathStat=await lstat(resolved,{bigint:true});
   if(fingerprint(before)!==fingerprint(after)||fingerprint(after)!==fingerprint(pathStat)||
     before.ctimeNs!==after.ctimeNs||after.ctimeNs!==pathStat.ctimeNs)throw fail();
   const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
   if(text.includes('\0'))throw fail();
   return{file:{path,sha256:sha(bytes),bytes:bytes.length,text},version:`${fingerprint(after)}:${after.ctimeNs}`};
 }finally{await fd.close();}
}
async function scan(root:string):Promise<ProfileSource>{
 if(!isAbsolute(root)||await realpath(root)!==root||root==='/')throw fail();
 const start=await lstat(root,{bigint:true});
 if(!start.isDirectory()||start.uid!==BigInt(process.getuid!())||(start.mode&0o022n)!==0n)throw fail();
 let manifest:{alias:unknown;files:unknown;requiredPermissions:unknown}={alias:basename(root),files:[],requiredPermissions:[]};
 const versions=new Map<string,string>();
 try{
   await lstat(join(root,'manifest.json'));
 }catch(error){
   if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;
   versions.set('manifest.json','ABSENT');
 }
 if(!versions.has('manifest.json')){
   const meta=await scopedFile(root,'manifest.json',8192);
   const value=JSON.parse(meta.file.text);
   if(value===null||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='alias,files,requiredPermissions')throw fail();
   manifest=value;versions.set('manifest.json',meta.version);
 }
 const {alias,files:paths,requiredPermissions}=manifest;
 if(typeof alias!=='string'||!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(alias)||!Array.isArray(paths)||paths.length>16||
   !Array.isArray(requiredPermissions)||requiredPermissions.length>20||
   requiredPermissions.some(value=>typeof value!=='string'||!/^[A-Z][A-Z0-9_]{0,47}$/.test(value))||
   new Set(requiredPermissions).size!==requiredPermissions.length)throw fail();
 if(paths.some(path=>typeof path!=='string'||path==='SKILL.md'||path.length>120||
   !/^(?:[A-Za-z0-9][A-Za-z0-9_-]*\/)*[A-Za-z0-9][A-Za-z0-9_.-]*\.(?:md|txt|json)$/.test(path)||path.includes('..'))||
   new Set(paths).size!==paths.length||paths.includes('manifest.json'))throw fail();
 const names=['SKILL.md',...paths.sort()],files:ProfileSource['files'][number][]=[];
 let bytes=0;
 for(const name of names){
   const item=await scopedFile(root,name,65536);
   bytes+=item.file.bytes;
   if(bytes>256*1024)throw new Error('RESOURCE_LIMIT');
   versions.set(name,item.version);files.push(item.file);
 }
 for(const [name,expected] of versions){
   const current=await lstat(join(root,name),{bigint:true}).catch(error=>{
     if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;
   });
   if((current?`${fingerprint(current)}:${current.ctimeNs}`:'ABSENT')!==expected)throw fail();
 }
 const end=await lstat(root,{bigint:true});
 if(await realpath(root)!==root||fingerprint(start)!==fingerprint(end)||start.ctimeNs!==end.ctimeNs)throw fail();
 const sourceDigest=sha(JSON.stringify({alias,requiredPermissions:[...requiredPermissions].sort(),files:files.map(({text:_text,...file})=>file)}));
 return{alias,requiredPermissions:[...requiredPermissions].sort(),sourceDigest,identity:sha(JSON.stringify([fingerprint(start),start.birthtimeNs.toString(),[...versions]])),files};
}

export function createProfileImportReader():ProfileImportPort{
 return{async read(root){
   if(process.platform!=='darwin'||process.arch!=='arm64'||process.versions.node!=='26.13.0')throw new Error('UNSUPPORTED_VERSION');
   if(typeof root!=='string'||!isAbsolute(root)||root.length>4096||await realpath(root).catch(()=>null)!==root)throw fail();
   const node=await realpath(process.execPath),manifest=findPackageJSON(import.meta.url);
   if(!manifest)throw fail();
   const arguments_=['-D',`NODE=${node}`,'-D',`ENTRY=${entry}`,'-D',`PACKAGE=${manifest}`,'-D',`SOURCE=${root}`,'-p',profileImportPolicy,node,entry,root];
   try{
     const {stdout}=await execute('/usr/bin/sandbox-exec',arguments_,{cwd:'/',env:{PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C'},timeout:3000,maxBuffer:2*1024*1024});
     const result=JSON.parse(stdout) as {source?:ProfileSource;error?:string};
     if(result.error==='RESOURCE_LIMIT')throw new Error('RESOURCE_LIMIT');
     if(!result.source||!result.source.files.length)throw fail();
     return result.source;
   }catch(error){
     if((error as Error).message==='RESOURCE_LIMIT')throw error;
     throw fail();
   }
 }};
}
if(import.meta.main){
 try{
   const source=await scan(process.argv[2]??'');
   process.stdout.write(JSON.stringify({source}));
 }catch(error){
   process.stdout.write(JSON.stringify({error:(error as Error).message==='RESOURCE_LIMIT'?'RESOURCE_LIMIT':'EXTENSION_UNTRUSTED'}));
 }
}
