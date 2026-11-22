import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {ArchiveContext} from '../../src/main/archive-context.ts';
import {ArchiveReader} from '../../src/main/read-handlers.ts';
import {validateRequest} from '../../src/shared/validation.ts';

test('picker entry refuses renderer paths and a late read cannot switch to another project',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'maestro-project-scope-'));
 try{
   const context=new ArchiveContext();
   await context.select(join(directory,'future','archive'));
   const first=randomUUID(),second=randomUUID();
   const cp=context.activateProject(first);
   const envelope={bridgeVersion:1,callId:randomUUID(),selectionEpoch:cp.selectionEpoch};
   assert.throws(()=>validateRequest('openRepository',{...envelope,path:'/tmp/other'}));
   validateRequest('selectProject',{...envelope,projectId:second});
   const deferred=Promise.withResolvers<never>();
   const reader=new ArchiveReader(context,{async call(){return deferred.promise;},close(){}});
   const pending=reader.read('getProject',{projectId:first});
   context.activateProject(second);
   deferred.resolve({storeId:randomUUID()} as never);
   await assert.rejects(pending,/STALE_CONTEXT/);
   assert.equal(context.capture().view.activeProjectId,second);
   assert.equal(context.capture().view.archiveHandle,cp.archiveHandle);
 }finally{await rm(directory,{recursive:true,force:true});}
});
