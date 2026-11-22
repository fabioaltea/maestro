import {featureObject} from '../features/bundle.js';
import {requireUuid,requireDecimal} from '../identifiers.js';
import type {EnvironmentInspection,EnvironmentManagerPin} from '../../ports/environment.js';

const locks={'pnpm-lock.yaml':'pnpm','package-lock.json':'npm','npm-shrinkwrap.json':'npm','yarn.lock':'yarn','bun.lock':'bun','bun.lockb':'bun'} as const;
const configFiles=['.npmrc','.pnpmfile.cjs','.pnpmfile.js','.pnpmfile.mjs','pnpm-workspace.yaml','pnpm-workspace.yml'];
export const ENVIRONMENT_INPUT_FILES=['package.json',...Object.keys(locks),...configFiles];
export interface EnvironmentStaticInput{readonly path:string;readonly text:string|null}
type Assessment=Omit<EnvironmentInspection,'inputs'|'inputDigest'>;
const dependencyFields=['dependencies','devDependencies','optionalDependencies','peerDependencies'];
const lifecycle=new Set(['preinstall','install','postinstall','prepublish','preprepare','prepare','postprepare']);

function dependencyConfigSafe(manifest:Record<string,unknown>){
 for(const key of dependencyFields){
   const raw=manifest[key];
   if(raw===undefined)continue;
   const dependencies=featureObject(raw);
   if(Object.values(dependencies).some(v=>typeof v!=='string'||v.length>256||/[:/\\]/.test(v)))return false;
 }
 return manifest.pnpm===undefined&&manifest.workspaces===undefined;
}
function registryScope(lock:string):string|null{
 if(/(?:^|[\s,{])(?:file:|link:|git[+:]|ssh:|github:|patch:|portal:|workspace:)|!!/im.test(lock))throw new Error('CONFIG_UNSAFE');
 const origins=new Set<string>();
 for(const url of lock.match(/https?:\/\/[^\s,}'"]+/g)??[]){
   const parsed=new URL(url);
   if(parsed.protocol!=='http:'||parsed.hostname!=='127.0.0.1'||!parsed.port||parsed.username||parsed.password||parsed.hash||parsed.search)
     throw new Error('CONFIG_UNSAFE');
   origins.add(parsed.origin);
 }
 if(origins.size>1)throw new Error('CONFIG_UNSAFE');
 return [...origins][0]??null;
}

export function analyzeEnvironmentPlan(inputs:readonly EnvironmentStaticInput[],pin:EnvironmentManagerPin|null,selectedVersion?:string):Assessment{
 const files=new Map(inputs.map(input=>[input.path,input.text])),lockNames=Object.keys(locks).filter(name=>files.has(name));
 let manifest:Record<string,unknown>={};
 let manifestInvalid=false;
 try{manifest=featureObject(JSON.parse(files.get('package.json')??''));}catch{manifestInvalid=true;}
 const declared=typeof manifest.packageManager==='string'?/^(pnpm|npm|yarn|bun)@([0-9]+\.[0-9]+\.[0-9]+)$/.exec(manifest.packageManager):null;
 const manager=(declared?.[1]??locks[lockNames[0] as keyof typeof locks]??'UNKNOWN') as Assessment['manager'];
 const managerVersion=declared?.[2]??selectedVersion??null;
 const scripts=manifest.scripts;
 const scriptNames=scripts&&typeof scripts==='object'&&!Array.isArray(scripts)?
   Object.keys(scripts).filter(name=>/^[a-zA-Z0-9:_-]{1,64}$/.test(name)).sort().slice(0,64):[];
 const common={manager,managerVersion,scriptNames};
 const manual=(reason:string):Assessment=>({...common,disposition:'MANUAL_REQUIRED',reason,pin:null,registryOrigin:null});
 if(manifestInvalid||inputs.some(input=>input.text===null)||configFiles.some(path=>files.has(path))||lockNames.length>1)return manual('CONFIG_UNSAFE');
 if(manager!=='pnpm')return manual('MANAGER_UNSUPPORTED');
 if(!pin)return manual('MANAGER_UNSUPPORTED');
 if(managerVersion!==pin.version||!declared&&manifest.packageManager!==undefined)return manual('MANAGER_MISMATCH');
 const lock=files.get('pnpm-lock.yaml');
 if(!lock||!/^lockfileVersion:\s*['"]?9\.0['"]?\s*$/m.test(lock))return manual('LOCKFILE_CHANGED');
 try{
   if(!dependencyConfigSafe(manifest))return manual('CONFIG_UNSAFE');
   if(scriptNames.some(name=>lifecycle.has(name)))return manual('SCRIPT_APPROVAL_REQUIRED');
   // pnpm 9.4 rewrites the wanted lock when there are no dependencies, even in frozen mode.
   if(!dependencyFields.some(key=>manifest[key]!==undefined&&Object.keys(featureObject(manifest[key])).length>0))return manual('MANAGER_UNSUPPORTED');
   const registryOrigin=registryScope(lock);
   return{...common,pin,disposition:'PLANNED',reason:null,registryOrigin};
 }catch{return manual('CONFIG_UNSAFE');}
}
export interface EnvironmentPlanFence{
 readonly planId:string;readonly workspaceGeneration:string;readonly inputDigest:string;readonly stateRevision:string;
}
export function requireCurrentEnvironmentPlan(actual:EnvironmentPlanFence,expected:EnvironmentPlanFence){
 if(requireUuid(actual.workspaceGeneration)!==requireUuid(expected.workspaceGeneration))throw new Error('STALE_TARGET');
 if(requireDecimal(actual.stateRevision)!==requireDecimal(expected.stateRevision))throw new Error('REVISION_CONFLICT');
 if(requireUuid(actual.planId)!==requireUuid(expected.planId)||actual.inputDigest!==expected.inputDigest)throw new Error('ENVIRONMENT_STALE');
}
