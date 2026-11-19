import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chmod, realpath, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { FEATURE_BASE_V4_SQL } from '../fixtures/feature-schema-v4.js';
import { createTestContext } from '../fixtures/test-context.js';
import { createPlatformPaths } from '../../src/platform/macos/paths.js';
import { createOwnershipLease, prepareOwnershipLeaseFiles } from '../../src/platform/macos/lease.js';
import { makeDeadline, systemClock } from '../../src/ports/clock.js';
import { upgradeFeatures, needsFeaturesUpgrade } from '../../src/storage/features-upgrade.js';
import { SQLiteStore } from '../../src/storage/sqlite-store.js';
async function fixture(t: Parameters<typeof createTestContext>[0]) {
 const c = await createTestContext(t), directory = await realpath(c.directory); await chmod(directory, 0o700); prepareOwnershipLeaseFiles(directory);
 const path = join(directory, 'state.sqlite'); const db = new Database(path); await chmod(path,0o600);
 const storeId = randomUUID(); db.exec(FEATURE_BASE_V4_SQL); db.prepare('INSERT INTO store(singleton,store_id,schema_version,owner_uid,canonical_path) VALUES(1,?,4,?,?)').run(storeId,process.getuid!(),directory); db.pragma('user_version=4'); db.close();
 const paths = (await createPlatformPaths().resolveArchive(directory,'write'))!, leases = createOwnershipLease();
 const control = leases.tryAcquire(paths.controlLeaseFile,'control'), daemon = leases.tryAcquire(paths.daemonLeaseFile,'daemon');
 if (control.status !== 'HELD' || daemon.status !== 'HELD') throw new Error('BLOCKED');
 t.after(() => { daemon.handle.release(); control.handle.release(); });
 return { path,storeId,options:{paths,controlLease:control.handle,daemonLease:daemon.handle,deadline:makeDeadline(systemClock,3000)} };
}
test('feature schema upgrade is explicit; historical reads do not migrate or create sidecars', async t => {
 const f=await fixture(t), before=await readFile(f.path), names=await readdir(f.options.paths.directory);
 assert.equal(needsFeaturesUpgrade(f.options.paths),true);
 const reader=new SQLiteStore({path:f.path,readonly:true,readonlyQuiescent:true}); assert.equal(reader.readSnapshot()!.store.schemaVersion,4); reader.close();
 assert.deepEqual(await readFile(f.path),before); assert.deepEqual(await readdir(f.options.paths.directory),names);
 upgradeFeatures(f.options); assert.equal(needsFeaturesUpgrade(f.options.paths),false);
 const db=new Database(f.path,{readonly:true});t.after(()=>db.close()); assert.equal(db.pragma('user_version',{simple:true}),5);
 assert.equal((db.prepare('SELECT store_id FROM store').get() as {store_id:string}).store_id,f.storeId);
 for(const name of ['workflow_operations','workflow_grants','workflow_artifacts','features_records','features_revisions','features_approvals','features_envelopes','features_turns']) assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name=?").get(name));
 assert.deepEqual(db.pragma('foreign_key_check'),[]);
});
for(const point of ['features.upgrade.beforeCommit','features.upgrade.committed']) test(`feature upgrade fault at ${point} leaves a complete schema and can reconcile`,async t=>{
 const f=await fixture(t);assert.throws(()=>upgradeFeatures({...f.options,checkpoint:p=>{if(p===point)throw new Error('FAULT');}}));
 const db=new Database(f.path,{readonly:true});const v=Number(db.pragma('user_version',{simple:true}));assert.equal(v,point.endsWith('beforeCommit')?4:5);assert.equal(db.pragma('integrity_check',{simple:true}),'ok');db.close();
 upgradeFeatures(f.options);assert.equal(needsFeaturesUpgrade(f.options.paths),false);
});
test('workflow UUID guards protect every old namespace in both directions',async t=>{
 const f=await fixture(t);upgradeFeatures(f.options);const db=new Database(f.path);t.after(()=>db.close());
 const instanceId=randomUUID();db.prepare("INSERT INTO instances VALUES(?,1,'1','RUNNING','2026-11-19T00:00:00.000Z',0,NULL)").run(instanceId);
 const insert=(id:string)=>db.prepare("INSERT INTO workflow_operations(request_id,namespace,action,payload_hash,canonical_intent,owner_uid,owning_instance_id,phase,outcome,accepted_at) VALUES(?,'FEATURE','create',?,'{}',?,?,'ACCEPTED','IN_PROGRESS','2026-11-19T00:00:00.000Z')").run(id,'a'.repeat(64),process.getuid!(),instanceId);
 for(const scope of ['LIFECYCLE','PROJECT']){const id=randomUUID();insert(id);assert.throws(()=>db.prepare('INSERT INTO request_catalog VALUES(?,?,?,?)').run(id,scope,scope==='PROJECT'?'REGISTER':'start','a'.repeat(64)),/IDEMPOTENCY_CONFLICT/);
 const old=randomUUID();db.prepare('INSERT INTO request_catalog VALUES(?,?,?,?)').run(old,scope,scope==='PROJECT'?'REGISTER':'start','a'.repeat(64));assert.throws(()=>insert(old),/IDEMPOTENCY_CONFLICT/);}
 const id=randomUUID();insert(id);assert.throws(()=>db.prepare("INSERT INTO discovery_operations(request_id,action,payload_hash,canonical_intent,owner_uid,owning_instance_id,phase,outcome,accepted_at) VALUES(?,'check',?,'{}',?,?,'ACCEPTED','IN_PROGRESS','2026-11-19T00:00:00.000Z')").run(id,'a'.repeat(64),process.getuid!(),instanceId),/IDEMPOTENCY_CONFLICT/);
 const old=randomUUID();db.prepare("INSERT INTO discovery_operations(request_id,action,payload_hash,canonical_intent,owner_uid,owning_instance_id,phase,outcome,accepted_at) VALUES(?,'check',?,'{}',?,?,'ACCEPTED','IN_PROGRESS','2026-11-19T00:00:00.000Z')").run(old,'a'.repeat(64),process.getuid!(),instanceId);assert.throws(()=>insert(old),/IDEMPOTENCY_CONFLICT/);
});
