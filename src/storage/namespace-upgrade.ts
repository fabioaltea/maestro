import Database from './sqlite-driver.js';
import type {ArchivePaths} from '../ports/platform.js';
import type {RegistryUpgradeOptions} from './registry-upgrade.js';
import {STORE_SCHEMA_SQL} from './schema.js';
import {readWorkflowUpgradeVersion,requireWorkflowUpgradeLeases,workflowUpgradeIdentity} from './workspaces-upgrade.js';

export function defineNamespaceUpgrade(spec:{
 readonly name:string;readonly version:number;readonly prerequisiteTables:readonly string[];readonly tables:readonly string[];
 readonly previous:(options:RegistryUpgradeOptions)=>void;readonly workflowTable:string;readonly workflowIndexes:string;readonly schema:string;
}){
 function version(db:Database.Database,paths:ArchivePaths){
   const current=readWorkflowUpgradeVersion(db,paths,spec.version);
   const tables=current===spec.version?[...spec.prerequisiteTables,...spec.tables]:
     current===spec.version-1?spec.prerequisiteTables:[];
   for(const name of tables)if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name))throw new Error('STATE_CORRUPT');
   return current;
 }
 function needs(paths:ArchivePaths){
   workflowUpgradeIdentity(paths);
   const db=new Database(paths.stateFile,{readonly:true,fileMustExist:true,timeout:50});
   try{return version(db,paths)<spec.version;}finally{db.close();}
 }
 function upgrade(options:RegistryUpgradeOptions){
   const {paths,deadline}=options;
   requireWorkflowUpgradeLeases(options);
   if(!needs(paths))return;
   spec.previous(options);
   const before=workflowUpgradeIdentity(paths);
   options.checkpoint?.(`${spec.name}.upgrade.preflight`);
   if(before!==workflowUpgradeIdentity(paths))throw new Error('BLOCKED');
   const db=new Database(paths.stateFile,{fileMustExist:true,timeout:50});
   try{
     db.pragma('foreign_keys=OFF');db.pragma('synchronous=FULL');
     db.transaction(()=>{
       if(version(db,paths)!==spec.version-1)throw new Error('STATE_INCOMPATIBLE');
       db.exec(STORE_SCHEMA_SQL.replace('CHECK(schema_version = 4)',`CHECK(schema_version = ${spec.version})`).replace('CREATE TABLE store (','CREATE TABLE store_new ('));
       db.exec(`INSERT INTO store_new SELECT singleton,store_id,${spec.version},owner_uid,canonical_path,revision,next_event_seq,current_instance_id FROM store;
         DROP TABLE store; ALTER TABLE store_new RENAME TO store;`);
       db.exec(spec.workflowTable.replace('CREATE TABLE workflow_operations (','CREATE TABLE workflow_operations_new ('));
       db.exec(`INSERT INTO workflow_operations_new SELECT * FROM workflow_operations;
         DROP TRIGGER catalog_workflow_uuid_guard;
         DROP TRIGGER discovery_workflow_uuid_guard;
         DROP TABLE workflow_operations;
         ALTER TABLE workflow_operations_new RENAME TO workflow_operations;`);
       db.exec(spec.workflowIndexes);db.exec(spec.schema);db.pragma(`user_version=${spec.version}`);
       if(version(db,paths)!==spec.version||db.pragma('integrity_check',{simple:true})!=='ok')throw new Error('STATE_CORRUPT');
       if(deadline.expired())throw new Error('DEADLINE_EXCEEDED');
       options.checkpoint?.(`${spec.name}.upgrade.beforeCommit`);
     }).immediate();
     options.checkpoint?.(`${spec.name}.upgrade.committed`);
   }finally{db.close();}
 }
 return{needs,upgrade};
}
