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
  const branchRef=workspaceBranchRef(featureId,workspaceId),ref=join(common,branchRef);
  await directoryChain(common,parents);
  await directoryChain(common,['worktrees',workspaceId]);
  for(const file of [ref,`${ref}.lock`]){
    const info=await pathInfo(file);
    if(info&&(!info.isFile()||info.nlink!==1n))throw new Error('OWNERSHIP_UNPROVEN');
  }
  const linked=await pathInfo(checkout);
  if(linked&&!linked.isDirectory())throw new Error('OWNERSHIP_UNPROVEN');
  return{checkout,worktrees,worktreeAdmin,root,reference,common,admin,branchRef,ref,baseRef:input.baseRef,baseOid:input.baseOid,featureId};
}

async function fingerprint(path:string){
  const info=await stat(path,{bigint:true});
  if(!info.isFile()||info.uid!==0n||(info.mode&0o022n)!==0n)throw new Error('WORKSPACE_UNSAFE');
  return `${info.dev}:${info.ino}:${info.size}:${info.ctimeNs}:${info.mtimeNs}`;
}

/** Closed native Git adapter. No user argv, environment, helper or general editor. */
export function createWorkspaceMutator(options:{readonly beforeRemove?:()=>Promise<void>}={}):WorkspacePort {
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
  async function git(scope:Scope,deadline:Deadline,args:readonly string[],effect?:readonly string[]|'delete-branch'){
    check(deadline);
    const {executable,identity,profileSha256}=await selected();
    const body=await readFile(profile);
    if(identity!==await fingerprint(executable)||profileSha256!==hash(body))throw new Error('WORKSPACE_UNSAFE');
    check(deadline);
    const params={EXECUTABLE:executable,REFERENCE:scope.reference,COMMON:scope.common,ADMIN:scope.admin,WORKTREE:scope.checkout,
      WORKTREES:scope.worktrees,WORKTREE_ADMIN:scope.worktreeAdmin,REF:scope.ref,REF_LOCK:scope.ref+'.lock',
      REF_HEADS:join(scope.common,'refs','heads'),REF_MAESTRO:join(scope.common,'refs','heads','maestro'),
      REF_FEATURE:join(scope.common,'refs','heads','maestro','feature'),REF_FEATURE_ID:dirname(scope.ref)};
    const literals=effect==='delete-branch'?[
      ['PACKED_LOCK',join(scope.common,'packed-refs.lock')],
      ['REFLOG',join(scope.common,'logs',scope.branchRef)],
    ] as const:effect?.map((path,index)=>[`UNLINK_${index}`,path] as const);
    const guard=effect==='delete-branch'
      ?'(allow file-write-create file-write-unlink (literal (param "PACKED_LOCK")))\n(allow file-write-unlink (literal (param "REFLOG")))'
      :literals?`(deny file-write-unlink (require-all (subpath (param "WORKTREE")) (require-not (require-any ${literals.map(([key])=>`(literal (param "${key}"))`).join(' ')}))))`:null;
    const policy=guard?['-p',body.toString('utf8')+'\n'+guard]:['-f',profile];
    const bindings=[...Object.entries(params),...(literals??[])].flatMap(([k,v])=>['-D',`${k}=${v}`]);
    return exec(sandbox,[...bindings,...policy,executable,...prefix,...args],
      {cwd:scope.reference,env:{...env,GIT_EXEC_PATH:dirname(executable)},timeout:Math.max(1,Math.min(26000,Math.floor(deadline.remainingMs()))),maxBuffer:1024*1024,encoding:'utf8'})
      .then(({stdout,stderr})=>({stdout,stderr,code:0}),(error:unknown)=>{
        if(!deadline.expired()&&error instanceof Error&&'code'in error&&typeof error.code==='number'&&'stderr'in error)
          return{stdout:'',stderr:String(error.stderr),code:error.code};
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
    const baseOid=await oid(scope,deadline,scope.baseRef),branchOid=await oid(scope,deadline,scope.branchRef);
    if(!entry){
      if(await pathInfo(scope.checkout)||await pathInfo(scope.worktreeAdmin))throw new Error('OWNERSHIP_UNPROVEN');
      return{baseOid,branchOid,worktree:null};
    }
    const branch=entry.find(v=>v.startsWith('branch '))?.slice(7);
    const head=entry.find(v=>v.startsWith('HEAD '))?.slice(5);
    const marker=join(scope.checkout,'.git');
    const [raw,commonLink,reverseLink]=await Promise.all([stableFile(marker),stableFile(join(scope.worktreeAdmin,'commondir')),stableFile(join(scope.worktreeAdmin,'gitdir'))]);
    if(branch!==scope.branchRef||head!==branchOid||!head||entry.some(text=>/^(locked|prunable)( |$)/.test(text))
      ||raw?.toString('utf8')!==`gitdir: ${scope.worktreeAdmin}\n`
      ||!commonLink||resolve(scope.worktreeAdmin,commonLink.toString('utf8').trim())!==scope.common||reverseLink?.toString('utf8').trim()!==marker)
      throw new Error('OWNERSHIP_UNPROVEN');
    return{baseOid,branchOid,worktree:{root:await filesystem.capture(scope.checkout,'directory'),
      adminDirectory:await filesystem.capture(scope.worktreeAdmin,'directory'),gitFile:await filesystem.capture(marker,'file'),branchRef:branch,headOid:head}};
  }

  async function prepare(input:WorkspaceMutationTarget,deadline:Deadline){
    const scope=await scopeFor(input),fingerprint=await config(scope,deadline);
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
  return{
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
