import Database from './sqlite-driver.js';
import { lstatSync,realpathSync } from 'node:fs';
import { join } from 'node:path';
import type { RegistryUpgradeOptions } from './registry-upgrade.js';
import type { ArchivePaths } from '../ports/platform.js';
import { upgradeDiscovery } from './discovery-upgrade.js';
import { STORE_SCHEMA_SQL } from './schema.js';
import { WORKFLOW_SCHEMA_SQL } from './workflow-schema.js';
import { FEATURES_SCHEMA_SQL } from './features-schema.js';
export const FEATURE_TABLES=['workflow_operations','workflow_grants','workflow_artifacts','workflow_budget','features_records','features_revisions','features_approvals','features_envelopes','features_turns'] as const;
function validate(paths:ArchivePaths):void {
 const d=lstatSync(paths.directory),f=lstatSync(paths.stateFile);
 if(paths.ownerUid!==process.getuid!()||realpathSync(paths.directory)!==paths.directory||!d.isDirectory()||d.isSymbolicLink()||d.uid!==paths.ownerUid||(d.mode&0o777)!==0o700
 ||paths.stateFile!==join(paths.directory,'state.sqlite')||!f.isFile()||f.isSymbolicLink()||f.nlink!==1||f.uid!==paths.ownerUid||(f.mode&0o777)!==0o600)throw new Error('UNAUTHORIZED');
}
function version(db:Database.Database,paths:ArchivePaths):number {
 const v=Number(db.pragma('user_version',{simple:true}));if(![2,3,4,5].includes(v))throw new Error('STATE_INCOMPATIBLE');
 const row=db.prepare('SELECT schema_version,owner_uid,canonical_path FROM store WHERE singleton=1').get() as {schema_version:number;owner_uid:number;canonical_path:string}|undefined;
 if(!row||row.schema_version!==v)throw new Error('STATE_INCOMPATIBLE');
 if(row.owner_uid!==paths.ownerUid||row.canonical_path!==paths.directory)throw new Error('UNAUTHORIZED');
 if(db.pragma('quick_check',{simple:true})!=='ok'||(db.pragma('foreign_key_check') as unknown[]).length)throw new Error('STATE_CORRUPT');
 if(v===5)for(const table of FEATURE_TABLES)if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))throw new Error('STATE_CORRUPT');
 return v;
}
export function needsFeaturesUpgrade(paths:ArchivePaths):boolean {
 validate(paths);const db=new Database(paths.stateFile,{readonly:true,fileMustExist:true,timeout:50});try{return version(db,paths)<5;}finally{db.close();}
}
/** Exclusive explicit start only. Each previous historical migration remains unchanged. */
export function upgradeFeatures(options:RegistryUpgradeOptions):void {
 const {paths,controlLease,daemonLease,deadline}=options;
 if(controlLease.scope!=='control'||daemonLease.scope!=='daemon'||controlLease.path!==paths.controlLeaseFile||daemonLease.path!==paths.daemonLeaseFile
 ||paths.controlLeaseFile!==join(paths.directory,'control-lease.sqlite')||paths.daemonLeaseFile!==join(paths.directory,'daemon-lease.sqlite'))throw new Error('BLOCKED');
 validate(paths);if(deadline.expired())throw new Error('DEADLINE_EXCEEDED');
 let probe=new Database(paths.stateFile,{readonly:true,fileMustExist:true,timeout:50});let current:number;
 try{current=version(probe,paths);}finally{probe.close();}
 if(current===5)return;
 if(current<4)upgradeDiscovery(options);
 validate(paths);const before=lstatSync(paths.stateFile,{bigint:true});options.checkpoint?.('features.upgrade.preflight');
 const after=lstatSync(paths.stateFile,{bigint:true});if(before.dev!==after.dev||before.ino!==after.ino||before.birthtimeNs!==after.birthtimeNs)throw new Error('BLOCKED');
 const db=new Database(paths.stateFile,{fileMustExist:true,timeout:50});
 try{
 db.pragma('foreign_keys=ON');db.pragma('synchronous=FULL');
 db.transaction(()=>{
  if(version(db,paths)!==4)throw new Error('STATE_INCOMPATIBLE');
  const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {name:string}[];
  for(const {name} of tables){if(!/^[a-z_]+$/.test(name))throw new Error('STATE_INCOMPATIBLE');if((db.pragma(`foreign_key_list(${name})`) as {table:string}[]).some(f=>f.table==='store'))throw new Error('STATE_INCOMPATIBLE');}
  db.exec(STORE_SCHEMA_SQL.replace('CHECK(schema_version = 4)','CHECK(schema_version = 5)').replace('CREATE TABLE store (','CREATE TABLE store_v5 ('));
  db.exec('INSERT INTO store_v5 SELECT singleton,store_id,5,owner_uid,canonical_path,revision,next_event_seq,current_instance_id FROM store');
  db.exec('DROP TABLE store');db.exec('ALTER TABLE store_v5 RENAME TO store');db.exec(WORKFLOW_SCHEMA_SQL);db.exec(FEATURES_SCHEMA_SQL);db.pragma('user_version=5');
  if(db.pragma('integrity_check',{simple:true})!=='ok'||(db.pragma('foreign_key_check') as unknown[]).length)throw new Error('STATE_CORRUPT');
  if(deadline.expired())throw new Error('DEADLINE_EXCEEDED');options.checkpoint?.('features.upgrade.beforeCommit');
 }).immediate();options.checkpoint?.('features.upgrade.committed');
 }finally{db.close();}
}
