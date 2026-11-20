import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {chmod,readFile,readdir,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import Database from 'better-sqlite3';
import {createTestContext} from '../fixtures/test-context.js';
import {FEATURE_BASE_V4_SQL} from '../fixtures/feature-schema-v4.js';
import {createPlatformPaths} from '../../src/platform/macos/paths.js';
import {createOwnershipLease,prepareOwnershipLeaseFiles} from '../../src/platform/macos/lease.js';
import {makeDeadline,systemClock} from '../../src/ports/clock.js';
import {upgradeEnvironments} from '../../src/storage/environments-upgrade.js';
import {SQLiteStore} from '../../src/storage/sqlite-store.js';

const upgradeModule='../../src/storage/profiles-upgrade.js';
const at='2026-11-19T00:00:00.000Z',hash='a'.repeat(64);
function workflow(db:Database.Database,id:string,scope:string,instanceId:string){
 db.prepare(`INSERT INTO workflow_operations
   (request_id,namespace,action,payload_hash,canonical_intent,owner_uid,owning_instance_id,phase,outcome,accepted_at)
   VALUES(?,?,'create',?,'{}',?,?,'ACCEPTED','IN_PROGRESS',?)`).run(id,scope,hash,process.getuid!(),instanceId,at);
}

async function archive(t:Parameters<typeof createTestContext>[0]){
 const context=await createTestContext(t),directory=await realpath(context.directory);
 prepareOwnershipLeaseFiles(directory);
 const path=join(directory,'state.sqlite'),storeId=randomUUID(),instanceId=randomUUID(),requestId=randomUUID(),grantId=randomUUID();
 const db=new Database(path);
 await chmod(path,0o600);
 db.exec(FEATURE_BASE_V4_SQL);db.pragma('user_version=4');
 db.prepare('INSERT INTO store(singleton,store_id,schema_version,owner_uid,canonical_path) VALUES(1,?,4,?,?)').run(storeId,process.getuid!(),directory);
 db.close();
 const paths=(await createPlatformPaths().resolveArchive(directory,'write'))!,leases=createOwnershipLease();
 const control=leases.tryAcquire(paths.controlLeaseFile,'control'),daemon=leases.tryAcquire(paths.daemonLeaseFile,'daemon');
 if(control.status!=='HELD'||daemon.status!=='HELD')throw new Error('BLOCKED');
 t.after(()=>{daemon.handle.release();control.handle.release();});
 const options={paths,controlLease:control.handle,daemonLease:daemon.handle,deadline:makeDeadline(systemClock,5000)};
 upgradeEnvironments(options);
 const old=new Database(path);
 old.prepare("INSERT INTO instances VALUES(?,1,'1','RUNNING',?,0,NULL)").run(instanceId,at);
 workflow(old,requestId,'ENVIRONMENT',instanceId);
 old.prepare("INSERT INTO workflow_grants VALUES(?,'{}',1,999,?)").run(grantId,requestId);
 old.close();
 return{path,storeId,instanceId,requestId,grantId,options};
}

test('schema 7 inspection is immutable and upgrading explicitly preserves Environment and ledger identity',async t=>{
 const {needsProfilesUpgrade,upgradeProfiles}=await import(upgradeModule);
 const f=await archive(t),before=await readFile(f.path),names=(await readdir(f.options.paths.directory)).sort();
 assert.equal(needsProfilesUpgrade(f.options.paths),true);
 const reader=new SQLiteStore({path:f.path,readonly:true,readonlyQuiescent:true});
 assert.equal(reader.readSnapshot()!.store.schemaVersion,7);
 reader.close();assert.deepEqual(await readFile(f.path),before);assert.deepEqual((await readdir(f.options.paths.directory)).sort(),names);
 upgradeProfiles(f.options);
 assert.equal(needsProfilesUpgrade(f.options.paths),false);
 const db=new Database(f.path);
 try{
   assert.equal(db.pragma('user_version',{simple:true}),8);
   assert.deepEqual(db.prepare('SELECT store_id,schema_version FROM store').get(),{store_id:f.storeId,schema_version:8});
   assert.equal((db.prepare('SELECT consumed_by_request_id FROM workflow_grants WHERE grant_id=?').get(f.grantId) as {consumed_by_request_id:string}).consumed_by_request_id,f.requestId);
   assert.deepEqual(db.pragma('foreign_key_check'),[]);
   assert.equal(db.pragma('integrity_check',{simple:true}),'ok');
 }finally{db.close();}
});

for(const point of ['profiles.upgrade.beforeCommit','profiles.upgrade.committed']){
 test(`schema 7→7 failure at ${point} leaves a complete version`,async t=>{
   const {upgradeProfiles}=await import(upgradeModule),f=await archive(t);
   assert.throws(()=>upgradeProfiles({...f.options,checkpoint:(wanted:string)=>{if(point===wanted)throw new Error('OWNED_FAULT');}}),/OWNED_FAULT/);
   const db=new Database(f.path);
   try{
     assert.equal(db.pragma('user_version',{simple:true}),point.endsWith('beforeCommit')?7:8);
     assert.equal(db.pragma('integrity_check',{simple:true}),'ok');assert.deepEqual(db.pragma('foreign_key_check'),[]);
   }finally{db.close();}
 });
}

test('Profile UUIDs collide bidirectionally with lifecycle, project, Discovery and workflow namespaces',async t=>{
 const {upgradeProfiles}=await import(upgradeModule),f=await archive(t);
 upgradeProfiles(f.options);
 const db=new Database(f.path);
 try{
   const legacy=[
     (id:string)=>db.prepare('INSERT INTO request_catalog VALUES(?,?,?,?)').run(id,'LIFECYCLE','start',hash),
     (id:string)=>db.prepare('INSERT INTO request_catalog VALUES(?,?,?,?)').run(id,'PROJECT','REGISTER',hash),
     (id:string)=>db.prepare(`INSERT INTO discovery_operations
       (request_id,action,payload_hash,canonical_intent,owner_uid,owning_instance_id,phase,outcome,accepted_at)
       VALUES(?,'check',?,'{}',?,?,'ACCEPTED','IN_PROGRESS',?)`).run(id,hash,process.getuid!(),f.instanceId,at),
     (id:string)=>workflow(db,id,'FEATURE',f.instanceId),
     (id:string)=>workflow(db,id,'WORKSPACE',f.instanceId),
     (id:string)=>workflow(db,id,'ENVIRONMENT',f.instanceId),
   ];
   for(const insert of legacy){
     const legacyId=randomUUID(),own=randomUUID();insert(legacyId);
     assert.throws(()=>workflow(db,legacyId,'PROFILE',f.instanceId),/IDEMPOTENCY_CONFLICT|UNIQUE constraint/);
     workflow(db,own,'PROFILE',f.instanceId);
     assert.throws(()=>insert(own),/IDEMPOTENCY_CONFLICT|UNIQUE constraint/);
   }
 }finally{db.close();}
});
