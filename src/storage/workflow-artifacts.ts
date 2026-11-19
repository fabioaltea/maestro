import {constants,openSync,closeSync,fstatSync,lstatSync,mkdirSync,readSync,writeSync,fsyncSync,readdirSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import type Database from 'better-sqlite3';
import type {WorkflowArtifact} from '../ports/workflow.js';
import {requireUuid} from '../domain/identifiers.js';
import {workflowArtifact,type FeatureRow} from './features-store.js';
const hash=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
export function createWorkflowArtifacts(db:Database.Database,directory:string,options:{readonly readonly:boolean;readonly checkpoint?:(p:string)=>void}){
 const root=join(directory,'workflow'),objects=join(root,'objects');const uid=process.getuid!();
 function dir(path:string,create:boolean){if(create){try{mkdirSync(path,{mode:0o700});}catch(e){if(!(e instanceof Error&&'code'in e&&e.code==='EEXIST'))throw e;}}
 const s=lstatSync(path);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==uid||(s.mode&0o777)!==0o700)throw new Error('UNAUTHORIZED');return s;}
 function roots(create=false){dir(directory,false);dir(root,create);return dir(objects,create);}
 function artifact(id:string):WorkflowArtifact{requireUuid(id);const row=db.prepare('SELECT * FROM workflow_artifacts WHERE artifact_id=?').get(id) as FeatureRow|undefined;if(!row)throw new Error('ARTIFACT_CORRUPT');return workflowArtifact(row);}
 function file(id:string,flags:number,create=false){requireUuid(id);const anchor=roots(create);const fd=openSync(join(objects,id),flags|constants.O_NOFOLLOW,0o600);
 try{const f=fstatSync(fd),current=roots();if(!f.isFile()||f.nlink!==1||f.uid!==uid||(f.mode&0o777)!==0o600||anchor.ino!==current.ino||anchor.dev!==current.dev)throw new Error('UNAUTHORIZED');return fd;}catch(e){closeSync(fd);throw e;}}
 function syncDir(){const fd=openSync(objects,constants.O_RDONLY|constants.O_NOFOLLOW);try{fsyncSync(fd);}finally{closeSync(fd);}}
 function whole(id:string,maximum:number):Buffer{const fd=file(id,constants.O_RDONLY);try{const before=fstatSync(fd);if(before.size>maximum)throw new Error('ARTIFACT_CORRUPT');const b=Buffer.alloc(before.size);let offset=0;while(offset<b.length){const n=readSync(fd,b,offset,b.length-offset,offset);if(!n)throw new Error('ARTIFACT_CORRUPT');offset+=n;}const after=fstatSync(fd);if(before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs)throw new Error('ARTIFACT_CORRUPT');return b;}finally{closeSync(fd);}}
 return{
 create(id:string){if(options.readonly)throw new Error('UNAUTHORIZED');const a=artifact(id);let fd:number;
 try{fd=file(id,constants.O_CREAT|constants.O_EXCL|constants.O_RDWR,true);}catch(e){if(!(e instanceof Error&&'code'in e&&e.code==='EEXIST'))throw e;fd=file(id,constants.O_RDWR);if(fstatSync(fd).size!==0){closeSync(fd);throw new Error('ARTIFACT_CORRUPT');}}
 try{fsyncSync(fd);}finally{closeSync(fd);}syncDir();options.checkpoint?.('workflow.artifact.created');return a;},
 append(id:string,offset:number,bytes:Uint8Array,sha256:string){if(options.readonly)throw new Error('UNAUTHORIZED');const a=artifact(id);
 if(a.state!=='RESERVED'||!Number.isSafeInteger(offset)||offset<0||bytes.length<1||bytes.length>8192||offset+bytes.length>a.expectedBytes||hash(bytes)!==sha256||offset>a.offsetBytes)throw new Error('INVALID_REQUEST');
 const fd=file(id,constants.O_RDWR);try{const size=fstatSync(fd).size;if(offset<a.offsetBytes||size>offset){const old=Buffer.alloc(bytes.length);if(readSync(fd,old,0,old.length,offset)!==old.length||!old.equals(Buffer.from(bytes))||offset+bytes.length>a.offsetBytes&&size!==offset+bytes.length)throw new Error('IDEMPOTENCY_CONFLICT');}
 else{if(size!==offset||a.offsetBytes!==offset)throw new Error('ARTIFACT_CORRUPT');let written=0;while(written<bytes.length){const n=writeSync(fd,bytes,written,bytes.length-written,offset+written);if(!n)throw new Error('PERSISTENCE_UNAVAILABLE');written+=n;}}
 fsyncSync(fd);options.checkpoint?.('workflow.artifact.append.synced');return Math.max(a.offsetBytes,offset+bytes.length);
 }finally{closeSync(fd);}},
 seal(id:string){if(options.readonly)throw new Error('UNAUTHORIZED');const a=artifact(id);if(!['RESERVED','SEALED'].includes(a.state)||a.offsetBytes!==a.expectedBytes)throw new Error('INVALID_REQUEST');const bytes=whole(id,a.expectedBytes);if(bytes.length!==a.expectedBytes||hash(bytes)!==a.sha256)throw new Error('ARTIFACT_CORRUPT');syncDir();options.checkpoint?.('workflow.artifact.sealed');return a;},
 read(id:string,offset:number,maximum:number){const a=artifact(id);if(!['SEALED','REFERENCED'].includes(a.state)||!Number.isSafeInteger(offset)||offset<0||offset>a.expectedBytes||!Number.isSafeInteger(maximum)||maximum<1||maximum>8192)throw new Error('ARTIFACT_CORRUPT');const b=whole(id,a.expectedBytes);if(b.length!==a.expectedBytes||hash(b)!==a.sha256)throw new Error('ARTIFACT_CORRUPT');return{bytes:b.subarray(offset,offset+maximum),sha256:a.sha256,totalBytes:b.length};},
 discard(id:string){if(options.readonly)throw new Error('UNAUTHORIZED');const a=artifact(id);if(a.referenceCount!==0||a.state==='REFERENCED')throw new Error('FEATURE_IN_USE');const fd=file(id,constants.O_RDONLY);closeSync(fd);unlinkSync(join(objects,id));syncDir();options.checkpoint?.('workflow.artifact.discarded');},
 reconcile(){if(options.readonly)throw new Error('UNAUTHORIZED');roots(true);
 for(const name of readdirSync(objects)){requireUuid(name);const fd=file(name,constants.O_RDONLY);const bytes=fstatSync(fd).blocks*512;closeSync(fd);
 const row=db.prepare('SELECT * FROM workflow_artifacts WHERE artifact_id=?').get(name) as FeatureRow|undefined;
 if(!row){db.prepare("INSERT INTO workflow_artifacts(artifact_id,kind,target_id,expected_bytes,sha256,offset_bytes,allocated_bytes,state,ref_count,created_at_ms) VALUES(?,'INPUT',NULL,?,?,0,?,'ORPHAN',0,?)").run(name,Math.min(262144,Math.max(1,bytes)),'0'.repeat(64),bytes,Date.now());}
 else if(bytes>Number(row.allocated_bytes))db.prepare('UPDATE workflow_artifacts SET allocated_bytes=? WHERE artifact_id=?').run(bytes,name);
 }
 for(const row of db.prepare("SELECT * FROM workflow_artifacts WHERE state IN ('SEALED','REFERENCED')").all() as FeatureRow[]){const a=workflowArtifact(row);try{this.read(a.artifactId,0,1);}catch{db.prepare("UPDATE workflow_artifacts SET state='CORRUPT' WHERE artifact_id=?").run(a.artifactId);}}
 },
 };
}
