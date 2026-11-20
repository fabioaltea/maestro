import {reviewOid,reviewTargetRef} from '../../../domain/review/state.js';
import type {RefAttribution} from '../../../domain/review/integration.js';
import {EXECUTION_LIMITS} from '../../../domain/execution/model.js';
import {workspaceBranchRef} from '../../../domain/workspaces/provision.js';
import {requireMatchingWorktree} from '../../../domain/workspaces/ownership.js';
import {requireCleanupEffect,requireCleanupTarget} from '../../../domain/workspaces/cleanup.js';
import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {lstat,open,opendir,readFile,realpath,stat} from 'node:fs/promises';
import {dirname,isAbsolute,join,relative,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {requireUuid} from '../../../domain/identifiers.js';
import type {Deadline} from '../../../ports/clock.js';
import type {FilesystemAnchor} from '../../../ports/repository.js';
import type {GitCandidate,GitCandidateScope,GitIntegrationPort,GitIntegrationScope,IntegrationGuard} from '../../../ports/git-integration.js';
import type {WorkspaceCleanupTarget,WorkspaceDiskObservation,WorkspaceGitPin,WorkspaceMutationTarget,WorkspacePort} from '../../../ports/workspace.js';
import {createFilesystemIdentity} from './filesystem-identity.js';
import {buildInspectionEnvironment,createGitRunner} from './runner.js';

const exec=promisify(execFile);
const profile=fileURLToPath(new URL('./workspace.sb',import.meta.url));
const sandbox='/usr/bin/sandbox-exec';
const version='git version 2.50.1 (Apple Git-155)';
const binaryHash='492bd04fb367c1d51dce2be4eb6d6778829a3623dc4327318dfcdd81bc4fac2e';
const env={...buildInspectionEnvironment({},'/var/empty'),GIT_ATTR_NOSYSTEM:'1'};
const prefix=['--no-pager','--no-optional-locks','--no-lazy-fetch','--no-replace-objects',
  '-c','core.hooksPath=/dev/null','-c','core.fsmonitor=false','-c','core.logAllRefUpdates=false',
  '-c','core.attributesFile=/dev/null','-c','core.sharedRepository=0','-c','credential.helper=',
  '-c','submodule.recurse=false','-c','worktree.guessRemote=false','-c','maintenance.auto=false','-c','gc.auto=0'];
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const filesystem=createFilesystemIdentity();
const allowedConfig=/^(?:core\.(?:repositoryformatversion|filemode|bare|logallrefupdates|ignorecase|precomposeunicode|symlinks|hookspath|fsmonitor)|extensions\.(?:objectformat|worktreeconfig)|user\.(?:name|email)|remote\..+\.(?:url|fetch)|branch\..+\.(?:remote|merge))$/;
const localRef=(value:string)=>/^refs\/heads\/[!-~]{1,1024}$/.test(value);

function nested(root:string,path:string){
  const suffix=relative(root,path);
  return !isAbsolute(suffix)&&suffix!=='..'&&!suffix.startsWith('../');
}
async function pathInfo(path:string){
  try{return await lstat(path,{bigint:true});}
  catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}
}
async function anchored(expected:FilesystemAnchor){
  const info=await pathInfo(expected.canonicalPath);
  if(!info||(expected.kind==='directory'?!info.isDirectory():!info.isFile())||
    filesystem.compare(expected,await filesystem.capture(expected.canonicalPath,expected.kind))!=='VERIFIED')throw new Error('OWNERSHIP_UNPROVEN');
  return info;
}
async function directoryChain(root:string,segments:readonly string[]){
  for(const segment of segments){
    root=join(root,segment);
    const info=await pathInfo(root);
    if(info&&!info.isDirectory())throw new Error('OWNERSHIP_UNPROVEN');
  }
}
async function stableFile(path:string,limit=16384){
  const info=await pathInfo(path);
  if(!info)return null;
  if(!info.isFile()||info.nlink!==1n||info.size>BigInt(limit))throw new Error('WORKSPACE_UNSAFE');
  const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
    const bytes=Buffer.alloc(limit+1);
    let length=0;
    while(length<bytes.length){
      const next=await handle.read(bytes,length,bytes.length-length,null);
      if(!next.bytesRead)break;
      length+=next.bytesRead;
    }
    const after=await handle.stat({bigint:true});
    if(length>limit||after.dev!==info.dev||after.ino!==info.ino||after.ctimeNs!==info.ctimeNs||after.mtimeNs!==info.mtimeNs
      ||after.size!==BigInt(length))throw new Error('WORKSPACE_UNSAFE');
    return bytes.subarray(0,length);
  }finally{await handle.close();}
}

async function scopeFor(input:Omit<WorkspaceMutationTarget,'baseOid'>&{baseOid?:string}){
  const workspaceId=requireUuid(input.workspaceId),featureId=requireUuid(input.featureId);
  if(workspaceId!==input.workspaceId||featureId!==input.featureId||!localRef(input.baseRef)||
    input.baseOid!==undefined&&!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(input.baseOid))throw new Error('INVALID_REQUEST');
  const [owner]=await Promise.all([anchored(input.ownedRoot),anchored(input.reference),anchored(input.commonDirectory),anchored(input.adminDirectory)]);
  const root=input.ownedRoot.canonicalPath,reference=input.reference.canonicalPath;
  const common=input.commonDirectory.canonicalPath,admin=input.adminDirectory.canonicalPath;
  if(owner.uid!==BigInt(process.getuid!())||(owner.mode&0o077n)!==0n
    ||[reference,common,admin].some(path=>nested(root,path)||nested(path,root)))throw new Error('OWNERSHIP_UNPROVEN');
  const checkout=join(root,workspaceId),worktrees=join(common,'worktrees'),worktreeAdmin=join(worktrees,workspaceId);
  const parents=['refs','heads','maestro','feature',featureId];
  const detached=input.integration==='STAGING';
  if(input.integration!==undefined&&!['GUARD','STAGING'].includes(input.integration))throw new Error('INVALID_REQUEST');
  if(input.integration)reviewTargetRef(input.baseRef);
  const branchRef=detached?'HEAD':input.integration==='GUARD'?input.baseRef:workspaceBranchRef(featureId,workspaceId);
  const ref=detached?join(worktreeAdmin,'HEAD'):join(common,branchRef);
  await directoryChain(common,input.integration==='GUARD'?branchRef.split('/').slice(0,-1):parents);
  await directoryChain(common,['worktrees',workspaceId]);
  for(const file of [ref,`${ref}.lock`]){
    const info=await pathInfo(file);
    if(info&&(!info.isFile()||info.nlink!==1n))throw new Error('OWNERSHIP_UNPROVEN');
  }
  const linked=await pathInfo(checkout);
  if(linked&&!linked.isDirectory())throw new Error('OWNERSHIP_UNPROVEN');
  return{checkout,worktrees,worktreeAdmin,root,reference,common,admin,branchRef,ref,baseRef:input.baseRef,baseOid:input.baseOid,featureId,detached};
}

async function fingerprint(path:string){
  const info=await stat(path,{bigint:true});
  if(!info.isFile()||info.uid!==0n||(info.mode&0o022n)!==0n)throw new Error('WORKSPACE_UNSAFE');
  return `${info.dev}:${info.ino}:${info.size}:${info.ctimeNs}:${info.mtimeNs}`;
}

/** Closed native Git adapter. No user argv, environment, helper or general editor. */
export function createWorkspaceMutator(options:{readonly beforeRemove?:()=>Promise<void>;readonly integrationCheckpoint?:(point:'ref.intent'|'ref.updated')=>void}={}):
 WorkspacePort&{integration:Omit<GitIntegrationPort,'qualification'>} {
  type Scope=Awaited<ReturnType<typeof scopeFor>>;
  const reader=createGitRunner();
  let pin:Promise<WorkspaceGitPin&{executable:string;identity:string}>|undefined;
  async function resolvePin(){
    if(process.platform!=='darwin'||process.arch!=='arm64')throw new Error('UNSUPPORTED_PLATFORM');
    const {stdout}=await exec('/usr/bin/xcrun',['--find','git'],{cwd:'/',env,timeout:1000,maxBuffer:4096});
    const executable=await realpath(stdout.trim());
    if(executable!=='/Applications/Xcode.app/Contents/Developer/usr/bin/git')throw new Error('WORKSPACE_UNSAFE');
    const identity=await fingerprint(executable);
    if(hash(await readFile(executable))!==binaryHash||identity!==await fingerprint(executable))throw new Error('WORKSPACE_UNSAFE');
    const capability=await reader.capabilities();
    if(capability.status!=='AVAILABLE'||capability.gitVersion!==version)throw new Error('WORKSPACE_UNSAFE');
    return{executable,identity,version,sha256:binaryHash,profileSha256:hash(await readFile(profile))};
  }
  const selected=()=>pin??=resolvePin();
  function check(deadline:Deadline){if(deadline.expired())throw new Error('DEADLINE_EXCEEDED');}
  async function git(scope:Scope,deadline:Deadline,args:readonly string[],effect?:readonly string[]|'delete-branch'|'read-only'|'integration-guard'|'integration-ref'|'integration-staging',maxOutputBytes=1024*1024,identityDate?:string){
    check(deadline);
    const {executable,identity,profileSha256}=await selected();
    const body=await readFile(profile);
    if(identity!==await fingerprint(executable)||profileSha256!==hash(body))throw new Error('WORKSPACE_UNSAFE');
    check(deadline);
    const params={EXECUTABLE:executable,REFERENCE:scope.reference,COMMON:scope.common,ADMIN:scope.admin,WORKTREE:scope.checkout,
      WORKTREES:scope.worktrees,WORKTREE_ADMIN:scope.worktreeAdmin,REF:scope.ref,REF_LOCK:scope.ref+'.lock',
      REF_HEADS:join(scope.common,'refs','heads'),REF_MAESTRO:join(scope.common,'refs','heads','maestro'),
      REF_FEATURE:join(scope.common,'refs','heads','maestro','feature'),REF_FEATURE_ID:dirname(scope.ref),OBJECTS:join(scope.common,'objects')};
    const literals=effect==='delete-branch'?[
      ['PACKED_LOCK',join(scope.common,'packed-refs.lock')],
      ['REFLOG',join(scope.common,'logs',scope.branchRef)],
    ] as const:effect==='integration-ref'?[['TARGET_LOG',join(scope.common,'logs',scope.branchRef)]] as const:
      typeof effect!=='string'?effect?.map((path,index)=>[`UNLINK_${index}`,path] as const):undefined;
    const scoped=effect==='read-only'?'(deny file-write* (require-not (literal "/dev/null")))':
      effect==='integration-guard'?`(deny file-write* (require-not (require-any (literal "/dev/null") (literal (param "WORKTREES"))
       (subpath (param "WORKTREE")) (subpath (param "WORKTREE_ADMIN")))))`:
      effect==='integration-ref'?`(allow file-write* (literal (param "TARGET_LOG")))
       (deny file-write* (require-not (require-any (literal "/dev/null") (literal (param "REF"))
        (literal (param "REF_LOCK")) (literal (param "TARGET_LOG")))))`:
      effect==='integration-staging'?`(allow file-write* (subpath (param "OBJECTS")))
       (deny file-write* (require-not (require-any (literal "/dev/null") (subpath (param "OBJECTS"))
         (subpath (param "WORKTREE")) (subpath (param "WORKTREE_ADMIN")))))`:null;
    const guard=scoped??(effect==='delete-branch'
      ?'(allow file-write-create file-write-unlink (literal (param "PACKED_LOCK")))\n(allow file-write-unlink (literal (param "REFLOG")))'
      :literals?`(deny file-write-unlink (require-all (subpath (param "WORKTREE")) (require-not (require-any ${literals.map(([key])=>`(literal (param "${key}"))`).join(' ')}))))`:null);
    const policy=guard?['-p',body.toString('utf8')+'\n'+guard]:['-f',profile];
    const bindings=[...Object.entries(params),...(literals??[])].flatMap(([k,v])=>['-D',`${k}=${v}`]);
    const author=identityDate?{GIT_AUTHOR_NAME:'Maestro',GIT_AUTHOR_EMAIL:'maestro@localhost',GIT_AUTHOR_DATE:identityDate,
      GIT_COMMITTER_NAME:'Maestro',GIT_COMMITTER_EMAIL:'maestro@localhost',GIT_COMMITTER_DATE:identityDate}:{};
    return exec(sandbox,[...bindings,...policy,executable,...prefix,...args],
      {cwd:scope.reference,env:{...env,...author,GIT_EXEC_PATH:dirname(executable)},timeout:Math.max(1,Math.min(26000,Math.floor(deadline.remainingMs()))),maxBuffer:maxOutputBytes,encoding:'utf8'})
      .then(({stdout,stderr})=>({stdout,stderr,code:0}),(error:unknown)=>{
        if(!deadline.expired()&&error instanceof Error&&'code'in error&&typeof error.code==='number'&&'stderr'in error)
          return{stdout:'',stderr:String(error.stderr),code:error.code};
        if(maxOutputBytes>1024*1024&&error instanceof Error&&'code' in error&&error.code==='ERR_CHILD_PROCESS_STDIO_MAXBUFFER')
          throw new Error('REVIEW_SCOPE_LIMIT');
        throw new Error(deadline.expired()?'DEADLINE_EXCEEDED':'OWNERSHIP_UNPROVEN');
      });
  }

  async function config(scope:Scope,deadline:Deadline){
    for(const leaf of ['alternates','http-alternates']){
      if(await pathInfo(join(scope.common,'objects','info',leaf)))throw new Error('WORKSPACE_UNSAFE');
    }
    const fingerprints:string[]=[];
    for(const file of new Set([join(scope.common,'config'),join(scope.admin,'config.worktree')])){
      const raw=await stableFile(file);
      if(!raw){fingerprints.push('ABSENT');continue;}
      const result=await reader.run({kind:'config-file',path:file},{cwd:scope.reference,deadline,readRoots:[scope.reference,scope.common,scope.admin],maxStdoutBytes:16384});
      if(!result.ok||result.exitCode!==0||result.stderrBytes!==0)throw new Error('WORKSPACE_UNSAFE');
      for(const pair of Buffer.from(result.stdout).toString('utf8').split('\0')){
        if(!pair)continue;
        const [key,value]=pair.split('\n',2);
        if(!key||!allowedConfig.test(key)||key==='core.bare'&&value!=='false')throw new Error('WORKSPACE_UNSAFE');
      }
      if(!raw.equals(await stableFile(file)??Buffer.alloc(0)))throw new Error('WORKSPACE_UNSAFE');
      fingerprints.push(hash(raw));
    }
    return fingerprints.join(':');
  }

  async function oid(scope:Scope,deadline:Deadline,ref:string){
    const result=await git(scope,deadline,['rev-parse','--quiet','--verify','--end-of-options',`${ref}^{commit}`]);
    if(result.code===1&&!result.stderr)return null;
    const value=result.stdout.trim();
    if(result.code||result.stderr||scope.baseOid!==undefined&&value.length!==scope.baseOid.length||!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value))throw new Error('OWNERSHIP_UNPROVEN');
    return value;
  }
  async function requireIntegrated(scope:Scope,deadline:Deadline,headOid:string,integrated:WorkspaceCleanupTarget){
    requireCleanupTarget(integrated,scope.branchRef);
    if(!localRef(integrated.targetRef)||!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(headOid)
      ||(await git(scope,deadline,['check-ref-format',integrated.targetRef])).code)throw new Error('INVALID_REQUEST');
    if(await oid(scope,deadline,integrated.targetRef)!==integrated.targetOid)throw new Error('BASE_CHANGED');
    const merged=await git(scope,deadline,['merge-base','--is-ancestor',headOid,integrated.targetOid]);
    if(merged.stderr||merged.code>1)throw new Error('OWNERSHIP_UNPROVEN');
    return merged.code===0;
  }
  async function requireUnpackedWorkspaceRef(scope:Scope){
    const packed=await stableFile(join(scope.common,'packed-refs'),1048576);
    if(packed?.toString('utf8').split('\n').some(line=>line.endsWith(' '+scope.branchRef)))throw new Error('WORKSPACE_UNSAFE');
    await directoryChain(scope.common,['logs','refs','heads','maestro','feature',scope.featureId]);
    const log=await pathInfo(join(scope.common,'logs',scope.branchRef));
    if(log&&(!log.isFile()||log.nlink!==1n))throw new Error('OWNERSHIP_UNPROVEN');
  }

  async function disk(scope:Scope,deadline:Deadline):Promise<WorkspaceDiskObservation>{
    const listed=await git(scope,deadline,['worktree','list','--porcelain','-z']);
    if(listed.code||listed.stderr)throw new Error('OWNERSHIP_UNPROVEN');
    const records=listed.stdout.split('\0\0').map(record=>record.split('\0'));
    const matches=records.filter(record=>record.includes(`worktree ${scope.checkout}`));
    if(records.some(record=>record.includes(`branch ${scope.branchRef}`)&&!matches.includes(record)))throw new Error('OWNERSHIP_UNPROVEN');
    if(matches.length>1)throw new Error('OWNERSHIP_UNPROVEN');
    const [entry]=matches;
    const baseOid=await oid(scope,deadline,scope.baseRef);
    const branchOid=scope.detached?(entry?await stableFile(join(scope.worktreeAdmin,'HEAD'),128).then(bytes=>bytes?.toString().trim()??null):null):
      await oid(scope,deadline,scope.branchRef);
    if(!entry){
      if(await pathInfo(scope.checkout)||await pathInfo(scope.worktreeAdmin))throw new Error('OWNERSHIP_UNPROVEN');
      return{baseOid,branchOid,worktree:null};
    }
    const branch=entry.find(v=>v.startsWith('branch '))?.slice(7);
    const head=entry.find(v=>v.startsWith('HEAD '))?.slice(5);
    const marker=join(scope.checkout,'.git');
    const [raw,commonLink,reverseLink]=await Promise.all([stableFile(marker),stableFile(join(scope.worktreeAdmin,'commondir')),stableFile(join(scope.worktreeAdmin,'gitdir'))]);
    if((scope.detached?branch!==undefined||!entry.includes('detached'):branch!==scope.branchRef)||head!==branchOid||!head||
      !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(head)||entry.some(text=>/^(locked|prunable)( |$)/.test(text))
      ||raw?.toString('utf8')!==`gitdir: ${scope.worktreeAdmin}\n`
      ||!commonLink||resolve(scope.worktreeAdmin,commonLink.toString('utf8').trim())!==scope.common||reverseLink?.toString('utf8').trim()!==marker)
      throw new Error('OWNERSHIP_UNPROVEN');
    return{baseOid,branchOid,worktree:{root:await filesystem.capture(scope.checkout,'directory'),
      adminDirectory:await filesystem.capture(scope.worktreeAdmin,'directory'),gitFile:await filesystem.capture(marker,'file'),branchRef:scope.branchRef,headOid:head}};
  }

  async function prepare(input:WorkspaceMutationTarget,deadline:Deadline){
    const scope=await scopeFor(input),fingerprint=await config(scope,deadline);
    if(input.integration&&await pathInfo(join(scope.worktreeAdmin,'config.worktree')))throw new Error('WORKSPACE_UNSAFE');
    if((await git(scope,deadline,['check-ref-format',scope.baseRef])).code)throw new Error('INVALID_REQUEST');
    return{scope,fingerprint};
  }
  async function verify(input:WorkspaceMutationTarget,scope:Scope,fingerprint:string,deadline:Deadline){
    await scopeFor(input);
    if(await config(scope,deadline)!==fingerprint)throw new Error('WORKSPACE_UNSAFE');
  }
  async function unlinkInventory(scope:Scope,deadline:Deadline){
    const status=await git(scope,deadline,['-C',scope.checkout,'status','--porcelain=v2','-z','--untracked-files=all','--ignored=matching']);
    if(status.code||status.stderr||status.stdout)throw new Error('UNINTEGRATED_WORK');
    const tracked=await git(scope,deadline,['-C',scope.checkout,'ls-files','-z','--cached']);
    if(tracked.code||tracked.stderr)throw new Error('OWNERSHIP_UNPROVEN');
    const allowed=new Set(tracked.stdout.split('\0').filter(Boolean));
    allowed.add('.git');
    const directories=new Set<string>();
    for(const entry of allowed){
      if(!entry.isWellFormed()||entry.includes('\uFFFD')||isAbsolute(entry)||entry.split('/').some(piece=>['','.','..'].includes(piece)))throw new Error('WORKSPACE_UNSAFE');
      for(let parent=dirname(entry);parent!=='.';parent=dirname(parent))directories.add(parent);
    }
    const paths=[scope.checkout];
    let bytes=Buffer.byteLength(scope.checkout);
    async function walk(root:string){
      check(deadline);
      const entries=await opendir(root);
      for await(const entry of entries){
        const path=join(root,entry.name),key=relative(scope.checkout,path);
        const tracked=allowed.delete(key);
        if(entry.isDirectory()?tracked||!directories.delete(key):!tracked||!entry.isFile()&&!entry.isSymbolicLink())throw new Error('UNINTEGRATED_WORK');
        bytes+=Buffer.byteLength(path);
        if(paths.length>=512||bytes>64000)throw new Error('RESOURCE_LIMIT');
        paths.push(path);
        if(entry.isDirectory())await walk(path);
      }
    }
    await walk(scope.checkout);
    if(allowed.size||directories.size)throw new Error('UNINTEGRATED_WORK');
    return paths;
  }
  async function integration(input:GitIntegrationScope,deadline:Deadline,guard?:IntegrationGuard,readDiff=false,preparedSource=false){
    reviewTargetRef(input.targetRef);reviewOid(input.sourceOid);reviewOid(input.targetOid);
    if(input.sourceOid.length!==input.targetOid.length||input.sourceOid===input.targetOid)throw new Error('INVALID_REQUEST');
    const {scope,fingerprint}=await prepare(input.source,deadline),guardId=requireUuid(input.guardId);
    if(guardId===input.source.workspaceId||scope.branchRef===input.targetRef)throw new Error('INVALID_REQUEST');
    if(await pathInfo(join(scope.worktreeAdmin,'config.worktree')))throw new Error('WORKSPACE_UNSAFE');
    const parts=input.targetRef.split('/');
    await directoryChain(scope.common,parts.slice(0,-1));
    await directoryChain(scope.common,['logs',...parts.slice(0,-1)]);
    const ref=join(scope.common,input.targetRef);
    for(const path of [ref,`${ref}.lock`,join(scope.common,'logs',input.targetRef)]){
      const info=await pathInfo(path);
      if(info&&(!info.isFile()||info.nlink!==1n))throw new Error('WORKSPACE_UNSAFE');
    }
    const candidateScope={...scope,checkout:join(scope.root,guardId),worktreeAdmin:join(scope.worktrees,guardId),branchRef:input.targetRef,ref};
    await directoryChain(scope.common,['worktrees',guardId]);
    if(await pathInfo(join(candidateScope.worktreeAdmin,'config.worktree')))throw new Error('WORKSPACE_UNSAFE');
    if((await git(scope,deadline,['check-ref-format',input.targetRef],'read-only')).code)throw new Error('INVALID_REQUEST');
    const source=await disk(scope,deadline);
    requireMatchingWorktree(input.ownership,source.worktree);
    if(source.worktree.headOid!==input.sourceOid)throw new Error('REVIEW_STALE');
    const status=async(checkout:Scope)=>{
      const r=await git(checkout,deadline,['-C',checkout.checkout,'status','--porcelain=v2','-z','--untracked-files=all','--ignored=matching'],'read-only');
      if(r.code||r.stderr)throw new Error('WORKSPACE_UNSAFE');
      return r.stdout;
    };
    const sourceStatus=await status(scope);
    if(sourceStatus&&!(preparedSource&&sourceStatus==='! node_modules/\0'))throw new Error('SOURCE_NOT_QUIESCENT');
    const listed=await git(scope,deadline,['worktree','list','--porcelain','-z'],'read-only');
    if(listed.code||listed.stderr)throw new Error('OWNERSHIP_UNPROVEN');
    const matches=listed.stdout.split('\0\0').map(record=>record.split('\0')).filter(record=>record.includes(`branch ${input.targetRef}`));
    if(guard){
      if(matches.length!==1||!matches[0]!.includes(`worktree ${candidateScope.checkout}`))throw new Error('INTEGRATION_UNKNOWN');
      const observed=(await disk(candidateScope,deadline)).worktree;
      requireMatchingWorktree(guard,observed);
    }else if(matches.length&&!readDiff)throw new Error('TARGET_IN_USE');
    const targetOid=await oid(scope,deadline,input.targetRef);
    if(targetOid===null)throw new Error('TARGET_MOVED');
    const sourceTree=await git(scope,deadline,['rev-parse','--verify',`${input.sourceOid}^{tree}`],'read-only');
    const sourceTreeOid=sourceTree.stdout.trim();
    if(sourceTree.code||sourceTree.stderr||!new RegExp(`^[a-f0-9]{${input.sourceOid.length}}$`).test(sourceTreeOid))throw new Error('WORKSPACE_UNSAFE');
    const ancestry=await git(scope,deadline,['merge-base','--is-ancestor',input.targetOid,input.sourceOid],'read-only');
    if(ancestry.stderr||ancestry.code>1)throw new Error('WORKSPACE_UNSAFE');
    await verify(input.source,scope,fingerprint,deadline);
    return{scope,candidateScope,targetOid,sourceOid:input.sourceOid,sourceTreeOid,fastForward:ancestry.code===0,status};
  }
  function stagingTarget(input:GitCandidateScope):WorkspaceMutationTarget{
    const workspaceId=requireUuid(input.stagingId);
    if(workspaceId===input.source.workspaceId||workspaceId===input.guardId)throw new Error('INVALID_REQUEST');
    return{...input.source,workspaceId,baseRef:input.targetRef,baseOid:input.targetOid,integration:'STAGING'};
  }
  async function candidateTree(input:GitCandidateScope,scope:Scope,result:Awaited<ReturnType<typeof integration>>,candidate:GitCandidate,deadline:Deadline){
    const {worktree}=await disk(scope,deadline);
    requireMatchingWorktree(candidate.staging,worktree);
    if(worktree.headOid!==candidate.candidateOid)throw new Error('CANDIDATE_CHANGED');
    const data=await git(scope,deadline,['show','-s','--format=%T%x00%P',candidate.candidateOid],'read-only');
    const [treeOid,parents]=data.stdout.trim().split('\0');
    if(data.code||data.stderr||treeOid!==candidate.treeOid||
      (result.fastForward?candidate.candidateOid!==input.sourceOid:parents!==`${input.targetOid} ${input.sourceOid}`))throw new Error('CANDIDATE_CHANGED');
    const status=await result.status(scope);
    if(status&&status!=='! node_modules/\0')throw new Error('CANDIDATE_CHANGED');
  }
  async function refProof(scope:Scope,expected:RefAttribution){
    const log=await stableFile(join(scope.common,'logs',scope.branchRef),1048576);
    const last=log?.toString('utf8').trimEnd().split('\n').at(-1);
    return last?.startsWith(`${expected.old} ${expected.candidate} `)&&last.endsWith(`\tmaestro-integration ${expected.requestId}`)?expected:null;
  }
  const integrationPort:Omit<GitIntegrationPort,'qualification'>={
    async preflight(input,deadline){
      const result=await integration(input,deadline);
      if(result.targetOid!==input.targetOid)throw new Error('TARGET_MOVED');
      const {targetOid,sourceOid,sourceTreeOid,fastForward}=result;
      return{targetOid,sourceOid,sourceTreeOid,fastForward};
    },
    async captureDiff(input,deadline){
      const before=await integration(input,deadline,undefined,true),{scope}=before;
      if(before.targetOid!==input.targetOid)throw new Error('TARGET_MOVED');
      const options=['-C',scope.checkout,'diff','--no-ext-diff','--no-textconv','--no-renames'];
      const names=await git(scope,deadline,[...options,'--name-only','-z',input.targetOid,input.sourceOid,'--'],'read-only',2097153);
      const listed=names.stdout.split('\0').filter(Boolean);
      if(names.code||names.stderr||!names.stdout.isWellFormed()||names.stdout.includes('\uFFFD'))throw new Error('WORKSPACE_UNSAFE');
      if(listed.length>100)throw new Error('REVIEW_SCOPE_LIMIT');
      const result=await git(scope,deadline,[...options,'--binary','--full-index',input.targetOid,input.sourceOid,'--'],'read-only',2097153);
      if(result.code||result.stderr||!result.stdout.isWellFormed()||result.stdout.includes('\uFFFD'))throw new Error('WORKSPACE_UNSAFE');
      const diff=Buffer.from(result.stdout);
      if(diff.length>2097152)throw new Error('REVIEW_SCOPE_LIMIT');
      const after=await integration(input,deadline,undefined,true);
      if(after.targetOid!==before.targetOid||after.sourceTreeOid!==before.sourceTreeOid)throw new Error('REVIEW_STALE');
      return{sourceOid:after.sourceOid,sourceTreeOid:after.sourceTreeOid,targetOid:after.targetOid,fastForward:after.fastForward,fileCount:listed.length,diff};
    },
    async reserveGuard(input,deadline){
      const result=await integration(input,deadline);
      if(result.targetOid!==input.targetOid)throw new Error('TARGET_MOVED');
      const {candidateScope}=result;
      if(await pathInfo(candidateScope.checkout)||await pathInfo(candidateScope.worktreeAdmin))throw new Error('TARGET_IN_USE');
      const added=await git(candidateScope,deadline,['worktree','add','--no-checkout','--no-guess-remote','--',candidateScope.checkout,input.targetRef.slice(11)],'integration-guard');
      if(added.code||added.stderr&&!/^Preparing worktree/.test(added.stderr))throw new Error('INTEGRATION_UNKNOWN');
      const guard=(await disk(candidateScope,deadline)).worktree;
      if(!guard||guard.headOid!==input.targetOid)throw new Error('INTEGRATION_UNKNOWN');
      if(await pathInfo(join(candidateScope.worktreeAdmin,'index')))throw new Error('INTEGRATION_UNKNOWN');
      for await(const file of await opendir(candidateScope.checkout))if(file.name!=='.git')throw new Error('INTEGRATION_UNKNOWN');
      const indexed=await git(candidateScope,deadline,['-C',candidateScope.checkout,'read-tree','-u','-m',input.targetOid],'integration-guard');
      if(indexed.code||indexed.stderr||await result.status(candidateScope))throw new Error('INTEGRATION_UNKNOWN');
      await integration(input,deadline,guard);
      return guard;
    },
    async prepareCandidate(input,guard,deadline){
      const result=await integration(input,deadline,guard,false,true);
      if(result.targetOid!==input.targetOid)throw new Error('TARGET_MOVED');
      const at=Date.parse(input.authoredAt);
      if(!Number.isFinite(at)||new Date(at).toISOString()!==input.authoredAt)throw new Error('INVALID_REQUEST');
      const target=stagingTarget(input),{scope,fingerprint}=await prepare(target,deadline);
      await directoryChain(scope.common,['objects']);
      if(await pathInfo(scope.checkout)||await pathInfo(scope.worktreeAdmin))throw new Error('CANDIDATE_CHANGED');
      const added=await git(scope,deadline,['worktree','add','--detach','--no-checkout','--',scope.checkout,input.targetOid],'integration-guard');
      if(added.code||added.stderr&&!/^Preparing worktree/.test(added.stderr))throw new Error('INTEGRATION_UNKNOWN');
      const initial=(await disk(scope,deadline)).worktree;
      if(!initial||initial.headOid!==input.targetOid||await pathInfo(join(scope.worktreeAdmin,'index')))throw new Error('INTEGRATION_UNKNOWN');
      for await(const file of await opendir(scope.checkout))if(file.name!=='.git')throw new Error('INTEGRATION_UNKNOWN');
      const stage=(args:readonly string[],effect:'integration-guard'|'integration-staging'|'read-only'='integration-guard',date?:string)=>
        git(scope,deadline,['-C',scope.checkout,...args],effect,1048576,date);
      const indexed=await stage(['read-tree','-u','-m',input.targetOid]);
      if(indexed.code||indexed.stderr||await result.status(scope))throw new Error('INTEGRATION_UNKNOWN');
      let next=input.sourceOid;
      if(!result.fastForward){
        const merged=await stage(['merge-tree','--write-tree','--no-messages',input.targetOid,input.sourceOid],'integration-staging');
        const date=`@${Math.floor(at/1000)} +0000`;
        if(merged.code===1&&!merged.stderr){
          const conflict=await stage(['merge','--no-ff','--no-commit','--no-edit','--no-autostash',input.sourceOid],'integration-staging',date);
          const unresolved=await stage(['ls-files','--unmerged','-z','--'],'read-only');
          if(conflict.code===1&&!unresolved.code&&!unresolved.stderr&&unresolved.stdout){
            const {worktree}=await disk(scope,deadline);
            requireMatchingWorktree(initial,worktree);
            await verify(target,scope,fingerprint,deadline);
            return{kind:'CONFLICT',staging:worktree};
          }
          throw new Error('INTEGRATION_UNKNOWN');
        }
        if(merged.code||merged.stderr)throw new Error('INTEGRATION_UNKNOWN');
        const tree=reviewOid(merged.stdout.trim());
        const committed=await stage(['commit-tree',tree,'-p',input.targetOid,'-p',input.sourceOid,'-m','Maestro local integration'],
          'integration-staging',date);
        if(committed.code||committed.stderr)throw new Error('INTEGRATION_UNKNOWN');
        next=reviewOid(committed.stdout.trim());
      }
      const moved=await stage(['read-tree','-u','-m',input.targetOid,next]);
      if(moved.code||moved.stderr)throw new Error('INTEGRATION_UNKNOWN');
      const head=await stage(['update-ref','--no-deref','HEAD',next,input.targetOid]);
      if(head.code||head.stderr)throw new Error('INTEGRATION_UNKNOWN');
      const {worktree}=await disk(scope,deadline);
      requireMatchingWorktree(initial,worktree);
      const tree=await stage(['rev-parse','--verify','HEAD^{tree}'],'read-only');
      if(tree.code||tree.stderr)throw new Error('INTEGRATION_UNKNOWN');
      const candidate={staging:worktree,candidateOid:worktree.headOid,treeOid:reviewOid(tree.stdout.trim())};
      await candidateTree(input,scope,result,candidate,deadline);
      await verify(target,scope,fingerprint,deadline);
      if((await integration(input,deadline,guard,false,true)).targetOid!==input.targetOid)throw new Error('TARGET_MOVED');
      return{kind:'READY',candidate};
    },
    async inspectCandidate(input,guard,candidate,deadline){
      const result=await integration(input,deadline,guard,false,true);
      if(result.targetOid!==input.targetOid)throw new Error('TARGET_MOVED');
      if(await result.status(result.candidateScope))throw new Error('INTEGRATION_UNKNOWN');
      const target=stagingTarget(input),{scope,fingerprint}=await prepare(target,deadline);
      await candidateTree(input,scope,result,candidate,deadline);
      await verify(target,scope,fingerprint,deadline);
    },
    async publishCandidate(input,guard,candidate,requestId,deadline){
      requireUuid(requestId);
      await integrationPort.inspectCandidate(input,guard,candidate,deadline);
      const {candidateScope}=await integration(input,deadline,guard,false,true);
      const expected={requestId,old:input.targetOid,candidate:candidate.candidateOid};
      options.integrationCheckpoint?.('ref.intent');
      const changed=await git(candidateScope,deadline,['update-ref','--create-reflog','--no-deref','-m',`maestro-integration ${requestId}`,
        input.targetRef,candidate.candidateOid,input.targetOid],'integration-ref',1048576,'@'+Math.floor(Date.now()/1000)+' +0000');
      if(changed.code||changed.stderr){
        if(await oid(candidateScope,deadline,input.targetRef)!==input.targetOid)throw new Error('TARGET_MOVED');
        throw new Error('INTEGRATION_UNKNOWN');
      }
      options.integrationCheckpoint?.('ref.updated');
      const observed=await integrationPort.observePublication(input,guard,expected,deadline);
      if(!observed.proof)throw new Error('INTEGRATION_UNKNOWN');
      return observed.proof;
    },
    async observePublication(input,guard,expected,deadline){
      requireUuid(expected.requestId);reviewOid(expected.candidate);
      if(expected.old!==input.targetOid)throw new Error('INVALID_REQUEST');
      const result=await integration(input,deadline,guard,false,true);
      return{targetOid:result.targetOid,proof:result.targetOid===expected.candidate?await refProof(result.candidateScope,expected):null};
    },
    async publishFastForward(input,guard,deadline){
      const result=await integration(input,deadline,guard),{candidateScope}=result;
      if(result.targetOid!==input.targetOid)throw new Error('TARGET_MOVED');
      if(!result.fastForward)throw new Error('CANDIDATE_CHANGED');
      if(await result.status(candidateScope))throw new Error('INTEGRATION_UNKNOWN');
      options.integrationCheckpoint?.('ref.intent');
      const changed=await git(candidateScope,deadline,['update-ref','--no-deref',input.targetRef,input.sourceOid,input.targetOid],'integration-ref');
      if(changed.code||changed.stderr){
        if(await oid(candidateScope,deadline,input.targetRef)!==input.targetOid)throw new Error('TARGET_MOVED');
        throw new Error('INTEGRATION_UNKNOWN');
      }
      options.integrationCheckpoint?.('ref.updated');
      const verified=await integration(input,deadline,guard);
      if(verified.targetOid!==input.sourceOid)throw new Error('INTEGRATION_UNKNOWN');
      return{resultingOid:verified.targetOid};
    },
    async syncGuard(input,guard,deadline,candidateOid){
      const result=await integration(input,deadline,guard,false,candidateOid!==undefined),{candidateScope}=result;
      const expected=reviewOid(candidateOid??input.sourceOid);
      if(result.targetOid!==expected)throw new Error('INTEGRATION_UNKNOWN');
      const inGuard=(args:readonly string[],write=false)=>git(candidateScope,deadline,['-C',candidateScope.checkout,...args],write?'integration-guard':'read-only');
      const flags=await inGuard(['ls-files','-v','-z','--']);
      if(flags.code||flags.stderr||flags.stdout.split('\0').some(item=>item&&item[0]!=='H'))throw new Error('INTEGRATION_UNKNOWN');
      if(!await result.status(candidateScope))return;
      const index=await inGuard(['diff-index','--cached','--quiet','--no-ext-diff','--no-textconv',input.targetOid,'--']);
      const work=await inGuard(['diff-files','--quiet','--no-ext-diff','--no-textconv','--']);
      const others=await inGuard(['ls-files','--others','-z','--']);
      if([index,work,others].some(value=>value.code||value.stderr)||others.stdout)throw new Error('INTEGRATION_UNKNOWN');
      const synced=await inGuard(['read-tree','-u','-m',input.targetOid,expected],true);
      if(synced.code||synced.stderr||await result.status(candidateScope))throw new Error('INTEGRATION_UNKNOWN');
      const verified=await integration(input,deadline,guard,false,candidateOid!==undefined);
      if(verified.targetOid!==expected)throw new Error('INTEGRATION_UNKNOWN');
    },
  };
  return{
    integration:integrationPort,
    async qualification(){const {version,sha256,profileSha256}=await selected();return{version,sha256,profileSha256};},
    async resolveBase(input,deadline){
      const scope=await scopeFor(input),before=await config(scope,deadline);
      if((await git(scope,deadline,['check-ref-format',scope.baseRef])).code)throw new Error('INVALID_BASE_BRANCH');
      const value=await oid(scope,deadline,scope.baseRef);
      if(value===null)throw new Error('INVALID_BASE_BRANCH');
      await scopeFor(input);
      if(await config(scope,deadline)!==before)throw new Error('WORKSPACE_UNSAFE');
      return value;
    },
    async observe(input,deadline){
      const {scope,fingerprint}=await prepare(input,deadline);
      const result=await disk(scope,deadline);
      await verify(input,scope,fingerprint,deadline);
      return result;
    },
    async inspect(input,deadline){
      const {scope,fingerprint}=await prepare(input,deadline);
      const observed=await disk(scope,deadline);
      if(!observed.worktree)return{disk:observed,status:null};
      const result=await git(scope,deadline,['-C',scope.checkout,'status','--porcelain=v2','-z','--untracked-files=all','--ignored=matching']);
      if(result.code||result.stderr)throw new Error('OWNERSHIP_UNPROVEN');
      const status={tracked:false,untracked:false,ignored:false,conflicts:false};
      const entries=result.stdout.split('\0');
      for(let i=0;i<entries.length-1;i++){
        const kind=entries[i]!.slice(0,2);
        if(kind==='1 '||kind==='2 '||kind==='u '){status.tracked=true;if(kind==='2 ')i++;}
        else if(kind==='? ')status.untracked=true;
        else if(kind==='! ')status.ignored=true;
        else throw new Error('OWNERSHIP_UNPROVEN');
        if(kind==='u ')status.conflicts=true;
      }
      const after=await disk(scope,deadline);
      requireMatchingWorktree(observed.worktree,after.worktree);
      if(observed.branchOid!==after.branchOid||observed.baseOid!==after.baseOid)throw new Error('REPOSITORY_UNSTABLE');
      await verify(input,scope,fingerprint,deadline);
      return{disk:after,status};
    },
    async captureCheckpoint(input,expected,deadline){
      const {scope,fingerprint}=await prepare(input,deadline);
      const before=(await disk(scope,deadline)).worktree;
      requireMatchingWorktree(expected,before);
      const collect=async()=>{
        const gitScope=['-C',scope.checkout];
        const changes=await git(scope,deadline,[...gitScope,'diff','--binary','--no-ext-diff','--no-textconv','--no-renames',before.headOid,'--']);
        const unmerged=await git(scope,deadline,[...gitScope,'ls-files','--unmerged','-z','--']);
        const files=await git(scope,deadline,[...gitScope,'ls-files','--others','--exclude-standard','-z','--']);
        if([changes,files,unmerged].some(result=>result.code||result.stderr))throw new Error('WORKSPACE_UNSAFE');
        if(unmerged.stdout)throw new Error('GIT_CONFLICT');
        const maximum=EXECUTION_LIMITS.checkpointBytes;
        let bytes=Buffer.byteLength(changes.stdout)+Buffer.byteLength(files.stdout);
        if(bytes>maximum)throw new Error('CONTEXT_LIMIT');
        const additions=[];
        for(const name of files.stdout.split('\0').filter(Boolean)){
          check(deadline);
          if(!name.isWellFormed()||/[\x00-\x1f\x7f\uFFFD]/.test(name)||
             name.split('/').some(part=>!part||['.','..','.git'].includes(part.toLowerCase())))throw new Error('WORKSPACE_UNSAFE');
          const file=join(scope.checkout,name);
          if(await realpath(file)!==file)throw new Error('WORKSPACE_UNSAFE');
          const info=await pathInfo(file);
          if(!info||!info.isFile()||info.uid!==BigInt(process.getuid!())||(info.mode&0o022n)!==0n)throw new Error('WORKSPACE_UNSAFE');
          if(info.size>BigInt(maximum-bytes))throw new Error('CONTEXT_LIMIT');
          const content=await stableFile(file,maximum-bytes);
          if(!content)throw new Error('REPOSITORY_UNSTABLE');
          bytes+=content.length;
          additions.push({path:name,mode:(info.mode&0o111n)===0n?'100644':'100755',base64:content.toString('base64')});
        }
        const patch=Buffer.from(JSON.stringify({version:1,baseOid:before.headOid,trackedDiff:changes.stdout,untracked:additions}));
        if(patch.length>maximum)throw new Error('CONTEXT_LIMIT');
        return patch;
      };
      const patch=await collect();
      if(!patch.equals(await collect()))throw new Error('REPOSITORY_UNSTABLE');
      const after=(await disk(scope,deadline)).worktree;
      requireMatchingWorktree(before,after);
      if(after.headOid!==before.headOid)throw new Error('CHECKPOINT_STALE');
      await verify(input,scope,fingerprint,deadline);
      return{treeDigest:hash(patch),patch};
    },
    async createBranch(input,deadline){
      const {scope,fingerprint}=await prepare(input,deadline);
      const current=await disk(scope,deadline);
      if(current.baseOid!==scope.baseOid)throw new Error('BASE_CHANGED');
      if(current.branchOid!==null)throw new Error('BRANCH_EXISTS');
      await verify(input,scope,fingerprint,deadline);
      const result=await git(scope,deadline,['update-ref','--no-deref',scope.branchRef,scope.baseOid,'0'.repeat(scope.baseOid.length)]);
      if(result.code||result.stderr)throw new Error('OWNERSHIP_UNPROVEN');
      await verify(input,scope,fingerprint,deadline);
      if(await oid(scope,deadline,scope.branchRef)!==scope.baseOid)throw new Error('OWNERSHIP_UNPROVEN');
    },
    async addWorktree(input,deadline){
      const {scope,fingerprint}=await prepare(input,deadline);
      const before=await disk(scope,deadline);
      if(before.baseOid!==scope.baseOid)throw new Error('BASE_CHANGED');
      if(before.worktree||before.branchOid!==scope.baseOid)throw new Error('OWNERSHIP_UNPROVEN');
      await verify(input,scope,fingerprint,deadline);
      const result=await git(scope,deadline,['worktree','add','--no-guess-remote','--',scope.checkout,scope.branchRef.slice('refs/heads/'.length)]);
      if(result.code)throw new Error('OWNERSHIP_UNPROVEN');
      await verify(input,scope,fingerprint,deadline);
      const after=await disk(scope,deadline);
      if(after.worktree?.headOid!==scope.baseOid||after.baseOid!==scope.baseOid)throw new Error('OWNERSHIP_UNPROVEN');
      return after;
    },
    async verifyIntegration(input,headOid,integrated,deadline){
      const {scope,fingerprint}=await prepare(input,deadline);
      await requireUnpackedWorkspaceRef(scope);
      const result=await requireIntegrated(scope,deadline,headOid,integrated);
      await verify(input,scope,fingerprint,deadline);
      return result;
    },
    async removeWorktree(input,expected,integrated,deadline){
      const {scope,fingerprint}=await prepare(input,deadline);
      const observed=(await disk(scope,deadline)).worktree;
      await requireUnpackedWorkspaceRef(scope);
      requireMatchingWorktree(expected,observed);
      if(observed.headOid!==expected.headOid)throw new Error('UNINTEGRATED_WORK');
      if(!await requireIntegrated(scope,deadline,observed.headOid,integrated))throw new Error('UNINTEGRATED_WORK');
      const paths=await unlinkInventory(scope,deadline);
      await verify(input,scope,fingerprint,deadline);
      await options.beforeRemove?.();
      if(await oid(scope,deadline,integrated.targetRef)!==integrated.targetOid)throw new Error('BASE_CHANGED');
      const result=await git(scope,deadline,['worktree','remove','--',scope.checkout],paths);
      if(result.code||result.stderr||await pathInfo(scope.checkout)||await pathInfo(scope.worktreeAdmin))throw new Error('OWNERSHIP_UNPROVEN');
    },
    async deleteBranch(input,headOid,integrated,deadline){
      const {scope,fingerprint}=await prepare(input,deadline);
      await requireUnpackedWorkspaceRef(scope);
      requireCleanupEffect(await disk(scope,deadline),headOid,'WORKTREE_REMOVED');
      await verify(input,scope,fingerprint,deadline);
      if(!await requireIntegrated(scope,deadline,headOid,integrated))throw new Error('UNINTEGRATED_WORK');
      // The files backend takes this temporary lock for even a loose deletion.
      // The dynamic profile leaves packed-refs and its rewrite tempfile read-only.
      const result=await git(scope,deadline,['update-ref','--no-deref','-d',scope.branchRef,headOid],'delete-branch');
      if(result.code||result.stderr)throw new Error('OWNERSHIP_UNPROVEN');
      if(await oid(scope,deadline,integrated.targetRef)!==integrated.targetOid)throw new Error('BASE_CHANGED');
      const observed=await disk(scope,deadline);
      requireCleanupEffect(observed,headOid,'BRANCH_REMOVED');
      await verify(input,scope,fingerprint,deadline);
      return observed;
    },
  };
}
