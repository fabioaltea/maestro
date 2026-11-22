import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {writeFile,symlink,readFile} from 'node:fs/promises';
import {createRegistryStore} from '../fixtures/registry-store.js';
import {canonicalWorkflowIntent} from '../../src/domain/workflow/authorization.js';
import type {WorkflowChange,WorkflowWrite,WorkflowArtifact,WorkflowAdmission} from '../../src/ports/workflow.js';
interface SyncWorkflow {commitFeatureState(change:WorkflowChange):WorkflowWrite;readWorkflowArtifact(id:string,offset:number,max:number):{bytes:Uint8Array;sha256:string;totalBytes:number};reconcileWorkflowArtifacts():void}
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
async function fixture(t:Parameters<typeof createRegistryStore>[0],checkpoint?:(p:string)=>void){const f=await createRegistryStore(t,checkpoint);const store=f.store as unknown as SyncWorkflow;
 assert.equal(typeof store.commitFeatureState,'function','T008 writer is required');
 const admission=(action:string,payload:Record<string,unknown>,requestId=randomUUID()):WorkflowAdmission=>({requestId,instanceId:f.instanceId,grantId:null,nowMs:Date.now(),canonicalIntent:canonicalWorkflowIntent({version:1,storeId:f.storeId,ownerUid:process.getuid!(),namespace:'ARTIFACT',action,targetId:null,projectId:null,expectedRevision:null,configRevision:null,payload})});
 const reserve=(bytes:Uint8Array)=>{const a=admission('reserve',{kind:'BUNDLE',expectedBytes:bytes.length,sha256:hash(bytes),targetId:null});const artifact:WorkflowArtifact={artifactId:a.requestId,kind:'BUNDLE',targetId:null,expectedBytes:bytes.length,sha256:hash(bytes),offsetBytes:0,allocatedBytes:0,state:'RESERVED',referenceCount:0,createdAtMs:a.nowMs,expiresAtMs:a.nowMs+900000};return store.commitFeatureState({kind:'reserve',admission:a,artifact}).artifact!;};
 const append=(id:string,offset:number,bytes:Uint8Array,a=admission('append',{artifactId:id,offset,byteLength:bytes.length,sha256:hash(bytes)}))=>store.commitFeatureState({kind:'append',admission:a,artifactId:id,offset,sha256:hash(bytes),bytes});
 const seal=(id:string)=>store.commitFeatureState({kind:'seal',admission:admission('seal',{artifactId:id}),artifactId:id});
 return{...f,workflow:store,admission,reserve,append,seal};}
test('workflow upload is durable, chunk-idempotent, hash-verified and cannot publish an incomplete object',async t=>{
 const f=await fixture(t),bytes=Buffer.from('private feature bundle'),a=f.reserve(bytes);
 assert.throws(()=>f.seal(a.artifactId),/ARTIFACT_CORRUPT|INVALID_REQUEST/);
 const command=f.admission('append',{artifactId:a.artifactId,offset:0,byteLength:bytes.length,sha256:hash(bytes)});
 const first=f.append(a.artifactId,0,bytes,command);assert.equal(first.operation!.outcome,'SUCCEEDED');assert.ok(!first.operation!.canonicalIntent.includes(bytes.toString('utf8')),'ledger records chunk hash/length, not content');
 assert.deepEqual(f.append(a.artifactId,0,bytes,command).operation,first.operation);
 assert.throws(()=>f.append(a.artifactId,0,Buffer.from('different'),command),/IDEMPOTENCY_CONFLICT|INVALID_REQUEST/);
 f.seal(a.artifactId);assert.deepEqual(Buffer.from(f.workflow.readWorkflowArtifact(a.artifactId,0,8192).bytes),bytes);
 await writeFile(join(f.directory,'workflow','objects',a.artifactId),'corrupt');assert.throws(()=>f.workflow.readWorkflowArtifact(a.artifactId,0,8192),/ARTIFACT_CORRUPT/);
});
test('workflow refuses links, open upload saturation, outside writes and raw data in ledger intent',async t=>{
 const f=await fixture(t);for(let i=0;i<4;i++)f.reserve(Buffer.from(`bundle${i}`));assert.throws(()=>f.reserve(Buffer.from('fifth')),/RESOURCE_LIMIT/);
 const outside=join(f.directory,'outside');await writeFile(outside,'KEEP');
 const db=f.store.readFeatureState({kind:'pending'});assert.deepEqual(db.items,[]);
 const artifacts=f.store.readFeatureState({kind:'budget'}).budget!;assert.equal(artifacts.openUploads,4);
 const opId=randomUUID(),a=f.admission('reserve',{kind:'BUNDLE',expectedBytes:4,sha256:hash(Buffer.from('DATA')),targetId:null},opId);
 // Saturation must fail without ever following this externally supplied filesystem object.
 await symlink(outside,join(f.directory,'workflow','objects',opId));
 assert.throws(()=>f.workflow.commitFeatureState({kind:'reserve',admission:a,artifact:{artifactId:opId,kind:'BUNDLE',targetId:null,expectedBytes:4,sha256:hash(Buffer.from('DATA')),offsetBytes:0,allocatedBytes:0,state:'RESERVED',referenceCount:0,createdAtMs:a.nowMs,expiresAtMs:a.nowMs+900000}}));
 assert.equal(await readFile(outside,'utf8'),'KEEP');
});
test('an append fault after fsync leaves a queryable intent and preserves bytes for reconciliation',async t=>{
 let armed=false;const f=await fixture(t,p=>{if(armed&&p==='workflow.artifact.append.synced')throw new Error('FAULT');});
 const bytes=Buffer.from('preserve this partial upload'),a=f.reserve(bytes);armed=true;const command=f.admission('append',{artifactId:a.artifactId,offset:0,byteLength:bytes.length,sha256:hash(bytes)});
 assert.throws(()=>f.append(a.artifactId,0,bytes,command));
 assert.equal(f.store.readFeatureState({kind:'operation',id:command.requestId}).operation!.outcome,'IN_PROGRESS');
 assert.deepEqual(await readFile(join(f.directory,'workflow','objects',a.artifactId)),bytes);
 armed=false;f.workflow.reconcileWorkflowArtifacts();assert.deepEqual(await readFile(join(f.directory,'workflow','objects',a.artifactId)),bytes);
});
test('an object link is rejected before writes even when quota is available',async t=>{
 const f=await fixture(t),outside=join(f.directory,'untouched');await writeFile(outside,'KEEP');
 const id=randomUUID();await f.reserve(Buffer.from('seed'));const a=f.admission('reserve',{kind:'BUNDLE',expectedBytes:4,sha256:hash(Buffer.from('DATA')),targetId:null},id);
 await symlink(outside,join(f.directory,'workflow','objects',id));
 assert.throws(()=>f.workflow.commitFeatureState({kind:'reserve',admission:a,artifact:{artifactId:id,kind:'BUNDLE',targetId:null,expectedBytes:4,sha256:hash(Buffer.from('DATA')),offsetBytes:0,allocatedBytes:0,state:'RESERVED',referenceCount:0,createdAtMs:a.nowMs,expiresAtMs:a.nowMs+900000}}));
 assert.equal(await readFile(outside,'utf8'),'KEEP');assert.equal(f.store.readFeatureState({kind:'operation',id}).operation!.phase,'ACCEPTED');
});
test('ordinary quota saturation preserves query and the cancellation reserve without filling a disk',async t=>{
 const {default:Database}=await import('better-sqlite3');const f=await fixture(t),db=new Database(f.path);t.after(()=>db.close());
 db.prepare("INSERT INTO workflow_artifacts(artifact_id,kind,expected_bytes,sha256,allocated_bytes,state,created_at_ms) VALUES(?,'INPUT',1,?,?,'ORPHAN',?)").run(randomUUID(),'a'.repeat(64),120*1024*1024,Date.now());
 assert.throws(()=>f.reserve(Buffer.from('must not fit')),/RESOURCE_LIMIT/);
 assert.ok(f.store.readFeatureState({kind:'budget'}).budget!.allocatedBytes>=120*1024*1024);
 const canonicalIntent=canonicalWorkflowIntent({version:1,storeId:f.storeId,ownerUid:process.getuid!(),namespace:'FEATURE',action:'cancel',targetId:randomUUID(),projectId:null,expectedRevision:'1',configRevision:null,payload:{}}),grantId=randomUUID(),at=Date.now();
 f.workflow.commitFeatureState({kind:'grant',grant:{grantId,canonicalIntent,createdAtMs:at,expiresAtMs:at+300000,consumedByRequestId:null}});
 const command={requestId:randomUUID(),canonicalIntent,grantId,instanceId:f.instanceId,nowMs:at};
 assert.equal(f.workflow.commitFeatureState({kind:'admit',admission:command}).operation!.outcome,'IN_PROGRESS');
});
