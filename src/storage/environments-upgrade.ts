import Database from './sqlite-driver.js';
import type {ArchivePaths} from '../ports/platform.js';
import type {RegistryUpgradeOptions} from './registry-upgrade.js';
import {STORE_SCHEMA_SQL} from './schema.js';
import {upgradeWorkspaces,workflowUpgradeIdentity,readWorkflowUpgradeVersion,requireWorkflowUpgradeLeases} from './workspaces-upgrade.js';
import {ENVIRONMENTS_SCHEMA_SQL,ENVIRONMENT_SCHEMA_VERSION,ENVIRONMENT_TABLES,WORKFLOW_OPERATIONS_V7_TABLE,
 WORKFLOW_OPERATIONS_V7_INDEXES_AND_TRIGGERS} from './environments-schema.js';

function version(database:Database.Database,paths:ArchivePaths){
 const current=readWorkflowUpgradeVersion(database,paths,ENVIRONMENT_SCHEMA_VERSION);
 if(current===ENVIRONMENT_SCHEMA_VERSION)for(const table of ENVIRONMENT_TABLES){
   if(!database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))throw new Error('STATE_CORRUPT');
 }
 return current;
}
export function needsEnvironmentsUpgrade(paths:ArchivePaths){
 workflowUpgradeIdentity(paths);
 const database=new Database(paths.stateFile,{readonly:true,fileMustExist:true,timeout:50});
 try{return version(database,paths)<ENVIRONMENT_SCHEMA_VERSION;}finally{database.close();}
}

export function upgradeEnvironments(options:RegistryUpgradeOptions){
 const {paths,deadline}=options;
 requireWorkflowUpgradeLeases(options);
 if(!needsEnvironmentsUpgrade(paths))return;
 upgradeWorkspaces(options);
 const before=workflowUpgradeIdentity(paths);
 options.checkpoint?.('environments.upgrade.preflight');
 if(before!==workflowUpgradeIdentity(paths))throw new Error('BLOCKED');
 const database=new Database(paths.stateFile,{fileMustExist:true,timeout:50});
 try{
   database.pragma('foreign_keys=OFF');
   database.pragma('synchronous=FULL');
   database.transaction(()=>{
     if(version(database,paths)!==6)throw new Error('STATE_INCOMPATIBLE');
     database.exec(STORE_SCHEMA_SQL.replace('CHECK(schema_version = 4)','CHECK(schema_version = 7)').replace('CREATE TABLE store (','CREATE TABLE store_v7 ('));
     database.exec('INSERT INTO store_v7 SELECT singleton,store_id,7,owner_uid,canonical_path,revision,next_event_seq,current_instance_id FROM store');
     database.exec('DROP TABLE store; ALTER TABLE store_v7 RENAME TO store;');
     database.exec(WORKFLOW_OPERATIONS_V7_TABLE.replace('CREATE TABLE workflow_operations (','CREATE TABLE workflow_operations_v7 ('));
     database.exec(`
       INSERT INTO workflow_operations_v7 SELECT * FROM workflow_operations;
       DROP TRIGGER catalog_workflow_uuid_guard;
       DROP TRIGGER discovery_workflow_uuid_guard;
       DROP TABLE workflow_operations;
       ALTER TABLE workflow_operations_v7 RENAME TO workflow_operations;
     `);
     database.exec(WORKFLOW_OPERATIONS_V7_INDEXES_AND_TRIGGERS);
     database.exec(ENVIRONMENTS_SCHEMA_SQL);
     database.pragma('user_version=7');
     if(version(database,paths)!==ENVIRONMENT_SCHEMA_VERSION||database.pragma('integrity_check',{simple:true})!=='ok')throw new Error('STATE_CORRUPT');
     if(deadline.expired())throw new Error('DEADLINE_EXCEEDED');
     options.checkpoint?.('environments.upgrade.beforeCommit');
   }).immediate();
   options.checkpoint?.('environments.upgrade.committed');
 }finally{database.close();}
}
