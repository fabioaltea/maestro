import type Database from 'better-sqlite3';
import {requireUuid} from '../domain/identifiers.js';
import type {WorkspaceQuery,WorkspaceRead,WorkspaceRecord} from '../ports/workspace.js';
import {WORKSPACE_SCHEMA_VERSION} from './workspaces-schema.js';

type Row=Record<string,string|number|bigint|null>;
export function requireWorkspaceSchema(database:Database.Database):void{
 if(Number(database.pragma('user_version',{simple:true}))!==WORKSPACE_SCHEMA_VERSION)throw new Error('WORKSPACE_NOT_INITIALIZED');
}
export function workspaceRecord(r:Row):WorkspaceRecord{
 return{
   workspaceId:String(r.workspace_id),featureId:String(r.feature_id),projectId:String(r.project_id),envelopeId:String(r.envelope_id),
   repositoryKey:String(r.repository_key),state:r.state as WorkspaceRecord['state'],stateRevision:String(r.state_revision),
   ownerGeneration:String(r.owner_generation),target:JSON.parse(String(r.target)) as WorkspaceRecord['target'],
   ownership:r.ownership===null?null:JSON.parse(String(r.ownership)) as WorkspaceRecord['ownership'],
   markerDigest:r.marker_digest===null?null:String(r.marker_digest),safeError:r.safe_error===null?null:String(r.safe_error),
   createdAt:String(r.created_at),updatedAt:String(r.updated_at),
 };
}
export function readWorkspaceState(database:Database.Database,query:WorkspaceQuery):WorkspaceRead{
 requireWorkspaceSchema(database);
 if(query.kind==='get'){
   const row=database.prepare('SELECT * FROM workspaces_records WHERE workspace_id=?').get(requireUuid(query.id)) as Row|undefined;
   return{workspace:row?workspaceRecord(row):null};
 }
 if(query.kind!=='list')throw new Error('INVALID_REQUEST');
 const projectId=requireUuid(query.projectId),offset=query.offset??0,limit=query.limit??20;
 if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>20)throw new Error('INVALID_REQUEST');
 const rows=database.prepare('SELECT * FROM workspaces_records WHERE project_id=? ORDER BY created_at,workspace_id LIMIT ? OFFSET ?').all(projectId,limit+1,offset) as Row[];
 const revision=database.prepare('SELECT revision FROM store WHERE singleton=1').get() as Row;
 return{items:rows.slice(0,limit).map(workspaceRecord),nextOffset:rows.length>limit?offset+limit:null,pageRevision:String(revision.revision)};
}
