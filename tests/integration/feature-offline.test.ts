import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {createRegistryStore} from '../fixtures/registry-store.js';
import {openStorage} from '../../src/storage/worker.js';
import {snapshotArchive} from '../fixtures/archive-snapshot.js';
import {canonicalWorkflowIntent} from '../../src/domain/workflow/authorization.js';
import type {WorkflowChange,WorkflowWrite,WorkflowAdmission,WorkflowArtifact} from '../../src/ports/workflow.js';

test('feature metadata and sealed data survive native confined offline reads without writes, migration or autostart',async t=>{
 const f=await createRegistryStore(t),write=(c:WorkflowChange)=>(f.store as unknown as {commitFeatureState(c:WorkflowChange):WorkflowWrite}).commitFeatureState(c);
 const data=Buffer.from('offline feature input'),sha256=createHash('sha256').update(data).digest('hex');
 const command=(action:string,payload:Record<string,unknown>,requestId=randomUUID()):WorkflowAdmission=>({requestId,grantId:null,instanceId:f.instanceId,nowMs:Date.now(),canonicalIntent:canonicalWorkflowIntent({version:1,storeId:f.storeId,ownerUid:process.getuid!(),namespace:'ARTIFACT',action,targetId:null,projectId:null,expectedRevision:null,configRevision:null,payload})});
 const a=command('reserve',{kind:'INPUT',expectedBytes:data.length,sha256,targetId:null});const value:WorkflowArtifact={artifactId:a.requestId,kind:'INPUT',targetId:null,expectedBytes:data.length,sha256,offsetBytes:0,allocatedBytes:0,state:'RESERVED',referenceCount:0,createdAtMs:a.nowMs,expiresAtMs:a.nowMs+900000};
 write({kind:'reserve',admission:a,artifact:value});write({kind:'append',admission:command('append',{artifactId:a.requestId,offset:0,byteLength:data.length,sha256}),artifactId:a.requestId,offset:0,sha256,bytes:data});write({kind:'seal',admission:command('seal',{artifactId:a.requestId}),artifactId:a.requestId});
 f.store.close();const before=await snapshotArchive(f.directory),reader=await openStorage({path:f.path,readonly:true});
 try{assert.equal((await reader.readFeatureState!({kind:'operation',id:a.requestId})).operation!.outcome,'SUCCEEDED');assert.deepEqual(Buffer.from((await reader.readWorkflowArtifact!(a.requestId,0,8192)).bytes),data);
 await assert.rejects(()=>reader.commitFeatureState!({kind:'reconcile',instanceId:f.instanceId,nowMs:Date.now()}),/UNAUTHORIZED/);
 }finally{await reader.close();}
 assert.deepEqual(await snapshotArchive(f.directory),before);
});
