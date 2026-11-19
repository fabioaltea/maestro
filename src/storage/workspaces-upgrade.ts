import Database from './sqlite-driver.js';
import {lstatSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import type {ArchivePaths} from '../ports/platform.js';
import type {RegistryUpgradeOptions} from './registry-upgrade.js';
import {FEATURE_TABLES,upgradeFeatures} from './features-upgrade.js';
import {STORE_SCHEMA_SQL} from './schema.js';
import {WORKSPACES_SCHEMA_SQL,WORKSPACE_TABLES,WORKSPACE_SCHEMA_VERSION,WORKFLOW_OPERATIONS_V6_TABLE,WORKFLOW_OPERATIONS_V6_INDEXES_AND_TRIGGERS} from './workspaces-schema.js';

function identity(paths:ArchivePaths){
 const directory=lstatSync(paths.directory,{bigint:true}),state=lstatSync(paths.stateFile,{bigint:true});
 const uid=BigInt(paths.ownerUid);
 if(paths.ownerUid!==process.getuid!()||realpathSync(paths.directory)!==paths.directory
   ||!directory.isDirectory()||directory.uid!==uid||(directory.mode&0o777n)!==0o700n
   ||paths.stateFile!==join(paths.directory,'state.sqlite')||!state.isFile()||state.nlink!==1n||state.uid!==uid||(state.mode&0o777n)!==0o600n)throw new Error('UNAUTHORIZED');
 return `${directory.dev}:${directory.ino}:${directory.birthtimeNs}:${state.dev}:${state.ino}:${state.birthtimeNs}`;
}
function version(database:Database.Database,paths:ArchivePaths){
 const value=Number(database.pragma('user_version',{simple:true}));
 if(![2,3,4,5,WORKSPACE_SCHEMA_VERSION].includes(value))throw new Error('STATE_INCOMPATIBLE');
 const store=database.prepare('SELECT schema_version,owner_uid,canonical_path FROM store WHERE singleton=1').get() as {schema_version:number;owner_uid:number;canonical_path:string}|undefined;
 if(!store||store.schema_version!==value)throw new Error('STATE_INCOMPATIBLE');
 if(store.owner_uid!==paths.ownerUid||store.canonical_path!==paths.directory)throw new Error('UNAUTHORIZED');
 if(database.pragma('quick_check',{simple:true})!=='ok'||(database.pragma('foreign_key_check') as unknown[]).length)throw new Error('STATE_CORRUPT');
 const tables=value===WORKSPACE_SCHEMA_VERSION?[...FEATURE_TABLES,...WORKSPACE_TABLES]:value===5?FEATURE_TABLES:[];
 for(const name of tables)if(!database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name))throw new Error('STATE_CORRUPT');
 return value;
}
export function needsWorkspacesUpgrade(paths:ArchivePaths){
 identity(paths);
 const database=new Database(paths.stateFile,{readonly:true,fileMustExist:true,timeout:50});
 try{return version(database,paths)<WORKSPACE_SCHEMA_VERSION;}finally{database.close();}
}

export function upgradeWorkspaces(options:RegistryUpgradeOptions){
 const {paths,controlLease,daemonLease,deadline}=options;
 if(controlLease.scope!=='control'||daemonLease.scope!=='daemon'||controlLease.path!==paths.controlLeaseFile||daemonLease.path!==paths.daemonLeaseFile
   ||paths.controlLeaseFile!==join(paths.directory,'control-lease.sqlite')||paths.daemonLeaseFile!==join(paths.directory,'daemon-lease.sqlite'))throw new Error('BLOCKED');
 if(deadline.expired())throw new Error('DEADLINE_EXCEEDED');
 if(!needsWorkspacesUpgrade(paths))return;
 upgradeFeatures(options);
 const before=identity(paths);
 options.checkpoint?.('workspaces.upgrade.preflight');
 if(before!==identity(paths))throw new Error('BLOCKED');
 const database=new Database(paths.stateFile,{fileMustExist:true,timeout:50});
 try{
   // SQLite cannot rebuild a parent while referenced children have FK actions
   // enabled. Both leases cover this transaction and all links are checked before commit.
   database.pragma('foreign_keys=OFF');
   database.pragma('synchronous=FULL');
   database.transaction(()=>{
     if(version(database,paths)!==5)throw new Error('STATE_INCOMPATIBLE');
     database.exec(STORE_SCHEMA_SQL.replace('CHECK(schema_version = 4)','CHECK(schema_version = 6)').replace('CREATE TABLE store (','CREATE TABLE store_v6 ('));
     database.exec('INSERT INTO store_v6 SELECT singleton,store_id,6,owner_uid,canonical_path,revision,next_event_seq,current_instance_id FROM store');
     database.exec('DROP TABLE store; ALTER TABLE store_v6 RENAME TO store;');
     database.exec(WORKFLOW_OPERATIONS_V6_TABLE.replace('CREATE TABLE workflow_operations (','CREATE TABLE workflow_operations_v6 ('));
     database.exec(`
       INSERT INTO workflow_operations_v6 SELECT * FROM workflow_operations;
       DROP TRIGGER catalog_workflow_uuid_guard;
       DROP TRIGGER discovery_workflow_uuid_guard;
       DROP TABLE workflow_operations;
       ALTER TABLE workflow_operations_v6 RENAME TO workflow_operations;
     `);
     database.exec(WORKFLOW_OPERATIONS_V6_INDEXES_AND_TRIGGERS);
     database.exec(WORKSPACES_SCHEMA_SQL);
     database.pragma('user_version=6');
     if(version(database,paths)!==WORKSPACE_SCHEMA_VERSION||database.pragma('integrity_check',{simple:true})!=='ok')throw new Error('STATE_CORRUPT');
     if(deadline.expired())throw new Error('DEADLINE_EXCEEDED');
     options.checkpoint?.('workspaces.upgrade.beforeCommit');
   }).immediate();
   options.checkpoint?.('workspaces.upgrade.committed');
 }finally{
   database.close();
 }
}
