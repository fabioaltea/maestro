import {test,expect} from '@playwright/test';
import {createScratch} from '../fixtures/desktop.ts';
import {chooseDirectory,launchDesktop} from '../fixtures/electron.ts';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import Database from 'better-sqlite3';
import {openOwnedWorktree} from '../fixtures/owned-worktree.ts';

test('review history is scoped to the selected archive and remains available offline',async()=>{
 const f=await createScratch(),other=await createScratch();
 try{
   const repo=await f.repository('review-fixture');
   expect((await f.cli(['daemon','start'])).result.outcome).toBe('SUCCEEDED');
   expect((await f.cli(['project','add',repo.path])).result.outcome).toBe('SUCCEEDED');
   const {app,page}=await launchDesktop(f);
   try{
     await chooseDirectory(app,f.archive);await page.getByRole('button',{name:'Apri archivio',exact:true}).click();
     await page.getByRole('button',{name:'Revisioni',exact:true}).click();
     const panel=page.getByRole('region',{name:'Revisioni delle feature'});
     await expect(panel.getByText('Nessuna revisione per questo progetto.')).toBeVisible();
     await expect(panel.getByRole('button',{name:'Nuova revisione'})).toBeEnabled();
     expect((await f.cli(['daemon','stop'])).result.outcome).toBe('SUCCEEDED');
     await panel.getByRole('button',{name:'Aggiorna revisioni'}).click();
     await expect(panel.getByText(/Servizio offline/)).toBeVisible();
     await expect(panel.getByRole('button',{name:'Nuova revisione'})).toBeDisabled();
     await chooseDirectory(app,other.directory);await page.getByRole('button',{name:'Apri archivio',exact:true}).click();
     await expect(page.getByText('review-fixture',{exact:true})).toHaveCount(0);
   }finally{await app.close();}
 }finally{await Promise.all([f.cleanup(),other.cleanup()]);}
});

test('review feedback confirms the original receipt and restores focus',async()=>{
 test.setTimeout(100000);
 const f=await createScratch();
 try{
   const {app,page,workspaceId}=await openOwnedWorktree(f);
   try{
     const stopped=await f.cli(['daemon','stop']);
     expect(stopped.result.outcome).toBe('SUCCEEDED');
     const at=new Date().toISOString(),instanceId=stopped.result.instanceId;
     const ids={profile:randomUUID(),session:randomUUID(),checkpoint:randomUUID(),artifact:randomUUID(),review:randomUUID()};
     const oid='a'.repeat(40),patch=JSON.stringify({version:1,baseOid:oid,trackedDiff:'',untracked:[]}),hash=createHash('sha256').update(patch).digest('hex');
     const objects=join(f.archive,'workflow','objects');
     await mkdir(objects,{recursive:true,mode:0o700});
     await writeFile(join(objects,ids.artifact),patch,{mode:0o600,flag:'wx'});
     const db=new Database(join(f.archive,'state.sqlite'));
     try{
       db.pragma('foreign_keys=ON');
       const w=db.prepare(`SELECT w.feature_id,w.project_id,w.envelope_id,f.current_revision_id FROM workspaces_records w
         JOIN features_records f USING(feature_id) WHERE w.workspace_id=?`).get(workspaceId) as
         {feature_id:string;project_id:string;envelope_id:string;current_revision_id:string};
       const role=db.prepare("SELECT entity_id,revision_id FROM profiles_records WHERE alias='backend'").get() as {entity_id:string;revision_id:string};
       db.transaction(()=>{
         function done(id:string,namespace:string,action:string,target:string){
           db.prepare(`INSERT INTO workflow_operations(request_id,namespace,action,payload_hash,canonical_intent,owner_uid,owning_instance_id,
             phase,outcome,target_id,accepted_at,completed_at) VALUES(?,?,?,?,'{}',?,?,'FINALIZED','SUCCEEDED',?,?,?)`)
             .run(id,namespace,action,hash,process.getuid!(),instanceId,target,at,at);
         }
         done(ids.profile,'PROFILE','resolve',role.entity_id);
         db.prepare("INSERT INTO profiles_resolutions VALUES(?,?,?,?,1,?,?,?,'[]',?)")
           .run(ids.profile,role.entity_id,role.revision_id,w.project_id,hash,hash,'{}',at);
         done(ids.session,'EXECUTION','start',w.feature_id);
         db.prepare("INSERT INTO execution_sessions VALUES(?,?,?,?,?,'READY_FOR_REVIEW',2,?,NULL,?,?,?)")
           .run(ids.session,w.feature_id,workspaceId,w.project_id,ids.profile,ids.session,w.envelope_id,at,at);
         db.prepare(`INSERT INTO execution_runs(run_id,session_id,generation,instance_id,provider_id,config_revision,capability_digest,input_digest,phase,outcome)
           VALUES(?,?,?,?,'codex',1,?,?,'FINALIZED','SUCCEEDED')`).run(ids.session,ids.session,randomUUID(),instanceId,hash,hash);
         done(ids.checkpoint,'EXECUTION','checkpoint',ids.session);
         db.prepare(`INSERT INTO workflow_artifacts(artifact_id,kind,target_id,expected_bytes,sha256,offset_bytes,allocated_bytes,state,ref_count,created_at_ms)
           VALUES(?,'CHECKPOINT',?,?,?,?,4096,'REFERENCED',1,?)`).run(ids.artifact,ids.session,Buffer.byteLength(patch),hash,Buffer.byteLength(patch),Date.now());
         db.prepare('INSERT INTO execution_checkpoints VALUES(?,?,?,?,?,?,?,?)').run(ids.checkpoint,ids.session,ids.session,hash,hash,ids.artifact,hash,at);
         db.prepare('UPDATE execution_sessions SET checkpoint_id=? WHERE session_id=?').run(ids.checkpoint,ids.session);
         done(ids.review,'REVIEW','create',w.feature_id);
         db.prepare(`INSERT INTO review_records VALUES(?,?,?,?,?,?,?,?,?,?,?,'DRAFT',1,?,0,0)`)
           .run(ids.review,w.project_id,w.feature_id,w.current_revision_id,workspaceId,ids.checkpoint,oid,oid,'refs/heads/review-target','b'.repeat(40),hash,at);
       })();
     }finally{db.close();}
     expect((await f.cli(['daemon','start'])).result.outcome).toBe('SUCCEEDED');
     await page.getByRole('button',{name:'Revisioni',exact:true}).click();
     const panel=page.getByRole('region',{name:'Revisioni delle feature'});
     await panel.getByRole('button',{name:/review-target/}).click();
     const prepare=panel.getByRole('button',{name:'Prepara richiesta di modifiche'});
     await panel.getByRole('textbox',{name:'Feedback'}).fill('Rivedere il contesto della modifica.');
     await prepare.click();
     await expect(page.getByRole('dialog')).toContainText(ids.review);
     await page.keyboard.press('Escape');
     await expect(prepare).toBeFocused();
     await prepare.click();
     await page.getByRole('button',{name:'Conferma operazione',exact:true}).click();
     const receipt=panel.getByRole('status');
     await expect(receipt).toContainText('SUCCEEDED');
     const requestId=(await receipt.textContent())?.match(/[a-f0-9-]{36}/)?.[0];
     expect(requestId).toBeTruthy();
     const queried=await f.cli(['review','operation',requestId!]);
     expect(queried.result.data.operation).toMatchObject({requestId,targetId:ids.review,outcome:'SUCCEEDED'});
     expect((await f.cli(['daemon','stop'])).result.outcome).toBe('SUCCEEDED');
     await panel.getByRole('button',{name:'Aggiorna dettaglio'}).click();
     await expect(panel.getByText(/Servizio offline/)).toBeVisible();
     await expect(prepare).toHaveCount(0);
   }finally{await app.close();}
 }finally{await f.cleanup();}
});
