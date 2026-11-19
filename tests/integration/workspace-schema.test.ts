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
import {upgradeFeatures} from '../../src/storage/features-upgrade.js';
import {SQLiteStore} from '../../src/storage/sqlite-store.js';

const upgradeModule='../../src/storage/workspaces-upgrade.js';
const time='2026-11-19T00:00:00.000Z';
const hash='a'.repeat(64);
type DB=Database.Database;

function workflow(db:DB,id:string,namespace:string,instanceId:string){
 db.prepare(`INSERT INTO workflow_operations
 (request_id,namespace,action,payload_hash,canonical_intent,owner_uid,owning_instance_id,phase,outcome,accepted_at)
 VALUES(?,?,'create',?,'{}',?,?,'ACCEPTED','IN_PROGRESS',?)`).run(id,namespace,hash,process.getuid!(),instanceId,time);
}
function discovery(db:DB,id:string,instanceId:string){
 db.prepare(`INSERT INTO discovery_operations
 (request_id,action,payload_hash,canonical_intent,owner_uid,owning_instance_id,phase,outcome,accepted_at)
 VALUES(?,'check',?,'{}',?,?,'ACCEPTED','IN_PROGRESS',?)`).run(id,hash,process.getuid!(),instanceId,time);
}

async function archive(t:Parameters<typeof createTestContext>[0]){
 const context=await createTestContext(t),directory=await realpath(context.directory);
 prepareOwnershipLeaseFiles(directory);
 const path=join(directory,'state.sqlite'),storeId=randomUUID(),instanceId=randomUUID(),requestId=randomUUID(),grantId=randomUUID();
 const state=new Database(path);
 await chmod(path,0o600);
 state.exec(FEATURE_BASE_V4_SQL);state.pragma('user_version=4');
 state.prepare('INSERT INTO store(singleton,store_id,schema_version,owner_uid,canonical_path) VALUES(1,?,4,?,?)').run(storeId,process.getuid!(),directory);
 state.close();
 const paths=(await createPlatformPaths().resolveArchive(directory,'write'))!,leases=createOwnershipLease();
 const control=leases.tryAcquire(paths.controlLeaseFile,'control'),daemon=leases.tryAcquire(paths.daemonLeaseFile,'daemon');
 if(control.status!=='HELD'||daemon.status!=='HELD')throw new Error('BLOCKED');
 t.after(()=>{daemon.handle.release();control.handle.release();});
 const options={paths,controlLease:control.handle,daemonLease:daemon.handle,deadline:makeDeadline(systemClock,5000)};
 upgradeFeatures(options);
 const old=new Database(path);
 old.prepare("INSERT INTO instances VALUES(?,1,'1','RUNNING',?,0,NULL)").run(instanceId,time);
 workflow(old,requestId,'FEATURE',instanceId);
 old.prepare("INSERT INTO workflow_grants VALUES(?,'{}',1,99,?)").run(grantId,requestId);
 old.close();
 return{path,storeId,instanceId,requestId,grantId,options};
}

test('schema 5 historical inspection is immutable and the explicit upgrade preserves operation and grant identity',async t=>{
 const {upgradeWorkspaces,needsWorkspacesUpgrade}=await import(upgradeModule);
 const f=await archive(t),before=await readFile(f.path),names=(await readdir(f.options.paths.directory)).sort();
 assert.equal(needsWorkspacesUpgrade(f.options.paths),true);
 const reader=new SQLiteStore({path:f.path,readonly:true,readonlyQuiescent:true});
 assert.equal(reader.readSnapshot()?.store.schemaVersion,5);
 reader.close();
 assert.deepEqual(await readFile(f.path),before);
 assert.deepEqual((await readdir(f.options.paths.directory)).sort(),names);
 upgradeWorkspaces(f.options);
 assert.equal(needsWorkspacesUpgrade(f.options.paths),false);
 const db=new Database(f.path);
 try{
   assert.equal(db.pragma('user_version',{simple:true}),6);
   assert.deepEqual(db.prepare('SELECT store_id,schema_version FROM store').get(),{store_id:f.storeId,schema_version:6});
   assert.equal((db.prepare('SELECT consumed_by_request_id FROM workflow_grants WHERE grant_id=?').get(f.grantId) as {consumed_by_request_id:string}).consumed_by_request_id,f.requestId);
   assert.deepEqual(db.pragma('foreign_key_check'),[]);
   assert.equal(db.pragma('integrity_check',{simple:true}),'ok');
 }finally{db.close();}
});

for(const point of ['workspaces.upgrade.beforeCommit','workspaces.upgrade.committed']){
 test(`schema 5→6 fault at ${point} leaves a complete readable version`,async t=>{
   const {upgradeWorkspaces,needsWorkspacesUpgrade}=await import(upgradeModule),f=await archive(t);
   assert.throws(()=>upgradeWorkspaces({...f.options,checkpoint:(wanted:string)=>{if(point===wanted)throw new Error('OWNED_FAULT');}}));
   const db=new Database(f.path);
   try{
     assert.equal(db.pragma('user_version',{simple:true}),point.endsWith('beforeCommit')?5:6);
     assert.equal(db.pragma('integrity_check',{simple:true}),'ok');
     assert.deepEqual(db.pragma('foreign_key_check'),[]);
   }finally{db.close();}
   upgradeWorkspaces(f.options);
   assert.equal(needsWorkspacesUpgrade(f.options.paths),false);
 });
}

test('workspace UUIDs collide with lifecycle, project, Discovery and feature in both directions',async t=>{
 const {upgradeWorkspaces}=await import(upgradeModule),f=await archive(t);
 upgradeWorkspaces(f.options);
 const db=new Database(f.path);
 try{
   const legacy=[(id:string)=>db.prepare('INSERT INTO request_catalog VALUES(?,?,?,?)').run(id,'LIFECYCLE','start',hash),
     (id:string)=>db.prepare('INSERT INTO request_catalog VALUES(?,?,?,?)').run(id,'PROJECT','REGISTER',hash),
     (id:string)=>discovery(db,id,f.instanceId),
     (id:string)=>workflow(db,id,'FEATURE',f.instanceId)];
   for(const insert of legacy){
     const old=randomUUID();insert(old);
     assert.throws(()=>workflow(db,old,'WORKSPACE',f.instanceId),/IDEMPOTENCY_CONFLICT|UNIQUE constraint/);
     const own=randomUUID();workflow(db,own,'WORKSPACE',f.instanceId);
     assert.throws(()=>insert(own),/IDEMPOTENCY_CONFLICT|UNIQUE constraint/);
   }
 }finally{db.close();}
});
