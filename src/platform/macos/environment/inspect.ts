import {createHash} from 'node:crypto';
import {lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {analyzeEnvironmentPlan,ENVIRONMENT_INPUT_FILES,type EnvironmentStaticInput} from '../../../domain/environments/plan.js';
import {ENVIRONMENT_LIMITS} from '../../../domain/environments/state.js';
import type {EnvironmentInputEntry,EnvironmentInspectPort,EnvironmentManagerPin} from '../../../ports/environment.js';
import {createFilesystemIdentity} from '../git/filesystem-identity.js';
import {createPnpmEnvironment,stableEnvironmentFile} from './pnpm.js';

const hash=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
const filesystem=createFilesystemIdentity();
async function fileVersion(path:string){
 try{
   const s=await lstat(path,{bigint:true});
   return{regular:s.isFile()&&s.nlink===1n&&s.uid===BigInt(process.getuid!()),bytes:s.isFile()?Number(s.size):0,
     fingerprint:`${s.dev}:${s.ino}:${s.birthtimeNs}:${s.ctimeNs}:${s.mtimeNs}:${s.size}:${s.mode}:${s.nlink}`};
 }catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}
}
const manifests=new Set(['package.json','pnpm-lock.yaml','package-lock.json','npm-shrinkwrap.json','yarn.lock','bun.lock','bun.lockb']);

/** Inputs are opened without following links. Local config is represented by identity without reading its contents. */
export function createEnvironmentInspector(configuredPin:()=>Promise<EnvironmentManagerPin>=createPnpmEnvironment().configuredPin):EnvironmentInspectPort{
 return{async inspect(root,deadline,selectedVersion){
   const path=root.canonicalPath;
   const check=async()=>{
     if(deadline.expired())throw new Error('DEADLINE_EXCEEDED');
     if(filesystem.compare(root,await filesystem.capture(path,'directory'))!=='VERIFIED')throw new Error('OWNERSHIP_UNPROVEN');
   };
   await check();
   const inputs:EnvironmentInputEntry[]=[],files:EnvironmentStaticInput[]=[],versions=new Map<string,string|null>();
   let used=0;
   for(const name of ENVIRONMENT_INPUT_FILES){
     if(deadline.expired())throw new Error('DEADLINE_EXCEEDED');
     const file=join(path,name),version=await fileVersion(file);
     versions.set(name,version?.fingerprint??null);
     if(!version)continue;
     if(used+version.bytes>ENVIRONMENT_LIMITS.inputBytes)throw new Error('RESOURCE_LIMIT');
     used+=version.bytes;
     if(!version.regular||!manifests.has(name)||name==='bun.lockb'){
       files.push({path:name,text:null});inputs.push({path:name,sha256:hash(version.fingerprint),bytes:version.bytes});
       continue;
     }
     const content=await stableEnvironmentFile(file,version.bytes);
     const text=new TextDecoder('utf-8',{fatal:true}).decode(content);
     files.push({path:name,text});inputs.push({path:name,sha256:hash(content),bytes:content.length});
   }
   let pin=null;
   if(files.some(file=>file.path==='pnpm-lock.yaml'))try{pin=await configuredPin();}catch{/* An unqualified manager requires explicit manual handling. */}
   for(const [name,expected] of versions)if(((await fileVersion(join(path,name)))?.fingerprint??null)!==expected)throw new Error('ENVIRONMENT_STALE');
   await check();
   const assessment=analyzeEnvironmentPlan(files,pin,selectedVersion);
   return{...assessment,inputs,inputDigest:hash(JSON.stringify(inputs))};
 }};
}
