import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {lstat,open,realpath} from 'node:fs/promises';
import {isAbsolute,join,normalize,relative} from 'node:path';
import type {ExecutionCapabilityInspection,ExecutionProviderId,ExecutionQualificationEvidence,ExecutionQualificationPort} from '../../../ports/execution.js';

const pins={
 codex:{version:'0.167.0',sha256:'030316ecfbb41f4e7946e584b0063ef333b7a36cd312ba349f2f6869e39b62cc'},
 claude:{version:'2.1.142',sha256:'772021afa051160b97e04d379738df84d4cacd311e8c199a325fb013b3eaa448'},
} satisfies Record<ExecutionProviderId,{version:string;sha256:string}>;

const base=`(version 1)
(deny default)
(allow process-exec (literal (param "EXECUTABLE")))
(allow file-read-metadata)
(allow sysctl-read)
(allow file-read-data (literal "/") (subpath "/System") (subpath "/usr/lib")
 (literal "/dev/null") (literal "/dev/random") (literal "/dev/urandom") (literal (param "EXECUTABLE")))
(allow file-write-data (literal "/dev/null"))
`;
export const executionCommandPolicy=base+`(allow file-read-data (literal (param "TARGET")))
(allow file-write-data (literal (param "TARGET")))
`;
export const executionProviderPolicy=base+`(allow file-read-data (subpath (param "RUNTIME"))
 (literal (param "INSTALLATION_ID"))
 (literal "/private/etc/hosts") (literal "/private/etc/resolv.conf") (literal "/private/etc/services")
 (literal "/private/etc/localtime")
 (literal "/Library/Application Support/Codex/requirements.toml")
 (literal "/Library/Application Support/Codex/config.toml"))
(allow file-write* (subpath (param "SCRATCH"))
 (literal (param "INSTALLATION_ID")))
`;
const codexDirectoryMetadata='(allow mach-lookup (global-name "com.apple.system.opendirectoryd.libinfo"))\n';
const syntheticLoopback='(allow network-outbound (remote tcp (param "SYNTHETIC_BACKEND")))\n';
interface Invocation{readonly executable:string;readonly args:readonly string[]}
function path(value:string){
 if(!isAbsolute(value)||normalize(value)!==value||!value.isWellFormed()||/[\x00-\x1f\x7f]/.test(value)||Buffer.byteLength(value)>4096)
   throw new Error('EXECUTION_UNSUPPORTED');
 return value;
}
function profile(executable:string,policy:string,scope:Record<string,string>):Invocation{
 if(process.platform!=='darwin'||process.arch!=='arm64')throw new Error('EXECUTION_UNSUPPORTED');
 path(executable);
 const values={EXECUTABLE:executable,...scope};
 return{executable:'/usr/bin/sandbox-exec',args:[...Object.entries(values).flatMap(([key,value])=>['-D',`${key}=${value}`]),'-p',policy,executable]};
}
async function privateDirectory(directory:string){
 path(directory);
 const observed=await lstat(directory);
 if(await realpath(directory)!==directory||!observed.isDirectory()||observed.uid!==process.getuid!()||(observed.mode&0o077)!==0)
   throw new Error('EXECUTION_UNSUPPORTED');
}
export async function createExecutionCommandProfile(input:{executable:string;workspace:string;target:string}){
 await privateDirectory(input.workspace);
 const target=path(input.target),suffix=relative(input.workspace,target);
 if(!suffix||isAbsolute(suffix)||suffix==='..'||suffix.startsWith('../')||suffix.split('/').some(part=>part.toLowerCase()==='.git')||
   await realpath(target)!==target)throw new Error('EXECUTION_UNSUPPORTED');
 const value=await lstat(target);
 if(!value.isFile()||value.nlink!==1||value.uid!==process.getuid!()||(value.mode&0o022)!==0)throw new Error('EXECUTION_UNSUPPORTED');
 return profile(input.executable,executionCommandPolicy,{TARGET:target});
}
export function createExecutionProviderProfile(input:{providerId:ExecutionProviderId;executable:string;runtime:string;installationId?:string;loopbackPort?:number}){
 const runtime=path(input.runtime),installationId=path(input.installationId??join(runtime,'scratch','unconfigured-installation'));
 if(input.installationId!==undefined&&(input.providerId!=='codex'||installationId!==join(runtime,'..','auth','installation_id')))
   throw new Error('EXECUTION_UNSUPPORTED');
 const port=input.loopbackPort;
 if(port!==undefined&&(!Number.isInteger(port)||port<1||port>65535))throw new Error('EXECUTION_UNSUPPORTED');
 return profile(input.executable,executionProviderPolicy+(input.providerId==='codex'?codexDirectoryMetadata:'')+(port?syntheticLoopback:''),{RUNTIME:runtime,SCRATCH:join(runtime,'scratch'),
   INSTALLATION_ID:installationId,...(port?{SYNTHETIC_BACKEND:`localhost:${port}`}:{})});
}

/** Qualification only. The caller owns disposable fixtures and the live child handle. */
export async function runExecutionQualificationProbe(invocation:Invocation,args:readonly string[],cwd:string,env:Readonly<NodeJS.ProcessEnv>={},input=''){
 if(Buffer.byteLength(input)>32768)throw new Error('RESOURCE_LIMIT');
 const child=spawn(invocation.executable,[...invocation.args,...args],{cwd,env:{PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C',...env},
   shell:false,stdio:['pipe','pipe','pipe']});
 const stdout:Buffer[]=[];
 let bytes=0,stderrBytes=0,overflow=false;
 const stop=()=>child.kill('SIGKILL');
 const timer=setTimeout(stop,8000);
 child.stdout.on('data',(part:Buffer)=>{
   bytes+=part.length;
   if(bytes>65536){overflow=true;stop();}else stdout.push(part);
 });
 child.stderr.on('data',(part:Buffer)=>{
   stderrBytes+=part.length;
   if(stderrBytes>16384){overflow=true;stop();}
 });
 child.stdin.on('error',()=>{});child.stdin.end(input);
 try{
   return await new Promise<{code:number|null;signal:string|null;stdout:string;stderrCode:string|null}>((resolve,reject)=>{
     child.once('error',reject);
     child.once('close',(code,signal)=>resolve({code,signal,stdout:overflow?'':Buffer.concat(stdout).toString('utf8'),
       stderrCode:overflow?'OUTPUT_LIMIT':stderrBytes?'PROVIDER_DIAGNOSTIC':null}));
   });
 }finally{clearTimeout(timer);}
}
async function executableDigest(binary:string){
 path(binary);
 if(await realpath(binary)!==binary)throw new Error('EXECUTION_UNSUPPORTED');
 const file=await open(binary,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
   const before=await file.stat({bigint:true}),hash=createHash('sha256');
   if(!before.isFile()||before.nlink!==1n||before.size>536870912n||
     (before.mode&0o022n)!==0n||(before.mode&0o100n)===0n)throw new Error('EXECUTION_UNSUPPORTED');
   for await(const bytes of file.createReadStream({autoClose:false}))hash.update(bytes);
   const after=await lstat(binary,{bigint:true});
   if(before.dev!==after.dev||before.ino!==after.ino||before.ctimeNs!==after.ctimeNs||before.size!==after.size||
     before.mode!==after.mode||before.nlink!==after.nlink)throw new Error('PROVIDER_UNSAFE');
   return hash.digest('hex');
 }finally{await file.close();}
}
export async function inspectExecutionProvider(providerId:ExecutionProviderId,binary:string,privateRoot:string):Promise<ExecutionCapabilityInspection>{
 const pin=pins[providerId],unsupported:ExecutionCapabilityInspection={providerId,version:null,sha256:null,configuration:[],catalogueQualified:false,error:'EXECUTION_UNSUPPORTED'};
 if(!pin)return unsupported;
 try{
   await privateDirectory(privateRoot);
   const sha256=await executableDigest(binary);
   if(sha256!==pin.sha256)return unsupported;
   const invocation=createExecutionProviderProfile({providerId,executable:binary,runtime:privateRoot});
   const home=join(privateRoot,'scratch'),env={HOME:home,TMPDIR:home,
     ...(providerId==='codex'?{CODEX_HOME:home}:{CLAUDE_CONFIG_DIR:home})};
   const version=await runExecutionQualificationProbe(invocation,['--version'],privateRoot,env);
   if(version.code!==0||!version.stdout.split(/[^0-9.]+/).includes(pin.version))return{...unsupported,sha256,error:'PROVIDER_UNSAFE'};
   const help=await runExecutionQualificationProbe(invocation,providerId==='codex'?['exec','--help']:['--help'],privateRoot,env);
   const options=providerId==='codex'?['--sandbox','--strict-config','--ignore-user-config','--output-schema']:
     ['--bare','--tools','--mcp-config','--strict-mcp-config','--permission-mode'];
   return{providerId,sha256,version:pin.version,configuration:help.code===0?options.filter(option=>help.stdout.includes(option)):[],
     catalogueQualified:false,error:help.code===0?null:'PROVIDER_UNSAFE'};
 }catch(error){return{...unsupported,error:(error as Error).message==='PROVIDER_UNSAFE'?'PROVIDER_UNSAFE':'EXECUTION_UNSUPPORTED'};}
}
export const executionQualificationPort:ExecutionQualificationPort={inspect:inspectExecutionProvider};
export function requireExecutionQualification(evidence:ExecutionQualificationEvidence){
 if(!evidence.pin||!evidence.commandBoundary||!evidence.ownershipProof||
   !evidence.brokers.some(broker=>broker.operation==='SCOPED_WRITE')||
   !evidence.brokers.some(broker=>broker.operation==='APPROVED_COMMAND')||
   evidence.observedCatalogue.length!==evidence.brokers.length||
   evidence.observedCatalogue.some(tool=>!evidence.brokers.some(broker=>broker.name===tool.name&&broker.type===tool.type)))
   throw new Error('EXECUTION_UNSUPPORTED');
}
