import {test,expect} from '@playwright/test';
import {createScratch} from '../fixtures/desktop.ts';
import {chooseDirectory,launchDesktop} from '../fixtures/electron.ts';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import Database from 'better-sqlite3';
import {openOwnedWorktree} from '../fixtures/owned-worktree.ts';

async function fixtureGit(directory:string,worktree:string,...args:string[]){
 expect(worktree.startsWith(`${directory}/`)).toBeTruthy();
 return (await promisify(execFile)('/usr/bin/git',[
   '-c','core.hooksPath=/dev/null','-c','user.name=Maestro Fixture','-c','user.email=fixture@example.invalid',...args,
 ],{cwd:worktree,timeout:5000,env:{PATH:'/usr/bin:/bin',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'}})).stdout.trim();
}

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

test('review feedback, candidate and completion preserve receipts and confirmation focus',async()=>{
 test.setTimeout(100000);
 const f=await createScratch();
 try{
   const {app,page,workspaceId}=await openOwnedWorktree(f);
   try{
     const stopped=await f.cli(['daemon','stop']);
     expect(stopped.result.outcome).toBe('SUCCEEDED');
     const at=new Date().toISOString(),instanceId=stopped.result.instanceId;
     const ids={profile:randomUUID(),session:randomUUID(),checkpoint:randomUUID(),artifact:randomUUID(),review:randomUUID()};
     const objects=join(f.archive,'workflow','objects');
     await mkdir(objects,{recursive:true,mode:0o700});
     const db=new Database(join(f.archive,'state.sqlite'));
     let oid:string,targetOid:string;
     try{
       db.pragma('foreign_keys=ON');
       const w=db.prepare(`SELECT w.feature_id,w.project_id,w.envelope_id,w.ownership,f.current_revision_id FROM workspaces_records w
         JOIN features_records f USING(feature_id) WHERE w.workspace_id=?`).get(workspaceId) as
         {feature_id:string;project_id:string;envelope_id:string;current_revision_id:string;ownership:string};
       const worktree=(JSON.parse(w.ownership) as {root:{canonicalPath:string}}).root.canonicalPath;
       const git=(...args:string[])=>fixtureGit(f.directory,worktree,...args);
       targetOid=await git('rev-parse','HEAD');
       await git('branch','review-target',targetOid);
       await writeFile(join(worktree,'REVIEW.md'),'Contenuto approvato.\n');
       await git('add','--','REVIEW.md');await git('commit','-m','synthetic review source');
       oid=await git('rev-parse','HEAD');const treeOid=await git('rev-parse','HEAD^{tree}');
       const patch=JSON.stringify({version:1,baseOid:oid,trackedDiff:'',untracked:[]}),hash=createHash('sha256').update(patch).digest('hex');
       await writeFile(join(objects,ids.artifact),patch,{mode:0o600,flag:'wx'});
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
           .run(ids.review,w.project_id,w.feature_id,w.current_revision_id,workspaceId,ids.checkpoint,oid,treeOid,'refs/heads/review-target',targetOid,hash,at);
       })();
     }finally{db.close();}
     const actor=fileURLToPath(new URL('../fixtures/workspace-daemon.ts',import.meta.url));
     await promisify(execFile)(process.execPath,[actor,f.archive],{timeout:35000,maxBuffer:16384});
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
     const candidate=panel.getByRole('button',{name:'Prepara candidate',exact:true});
     await candidate.click();
     await expect(page.getByRole('dialog')).toContainText(targetOid);
     await page.keyboard.press('Escape');await expect(candidate).toBeFocused();
     await candidate.click();await page.getByRole('button',{name:'Conferma operazione',exact:true}).click();
     await expect(receipt).toBeVisible();
     const candidateId=(await receipt.textContent())?.match(/[a-f0-9-]{36}/)?.[0];
     expect(candidateId).toBeTruthy();
     await expect.poll(async()=>(await f.cli(['review','operation',candidateId!])).result.outcome).toBe('SUCCEEDED');
     const reconcile=panel.getByRole('button',{name:'Aggiorna esito'});
     if(await reconcile.isVisible())await reconcile.click();
     await expect(receipt).toContainText('SUCCEEDED');
     await panel.getByRole('button',{name:'Aggiorna dettaglio'}).click();
     await expect(panel.getByText('Commit candidate',{exact:true})).toBeVisible();
     await expect(panel.getByRole('button',{name:'Prepara integrazione locale'})).toBeDisabled();
     const paused=await f.cli(['daemon','stop']);
     expect(paused.result.outcome).toBe('SUCCEEDED');
     await panel.getByRole('button',{name:'Aggiorna dettaglio'}).click();
     await expect(panel.getByText(/Servizio offline/)).toBeVisible();
     await expect(panel.getByText('Commit candidate',{exact:true})).toBeVisible();

     // The core integration suite produces the CAS and validates 007. Replay its finalized shape for the Desktop closure.
     const history=new Database(join(f.archive,'state.sqlite'));
     const decisionId=randomUUID(),integrationId=randomUUID(),targetRef='refs/heads/review-target';
     let integratedOid:string;
     try{
       history.pragma('foreign_keys=ON');
       const candidate=history.prepare(`SELECT c.candidate_oid,c.guard_id,r.digest,w.repository_key,w.ownership FROM review_candidates c
         JOIN review_records r USING(review_id) JOIN workspaces_records w ON w.workspace_id=r.workspace_id WHERE c.candidate_id=?`)
         .get(candidateId) as {candidate_oid:string;guard_id:string;digest:string;repository_key:string;ownership:string};
       integratedOid=candidate.candidate_oid;
       const guard=history.prepare('SELECT ownership FROM workspaces_records WHERE workspace_id=?').get(candidate.guard_id) as {ownership:string};
       const root=(item:{ownership:string})=>(JSON.parse(item.ownership) as {root:{canonicalPath:string}}).root.canonicalPath;
       await fixtureGit(f.directory,root(candidate),'update-ref','--create-reflog','-m',`maestro-integration ${integrationId}`,targetRef,integratedOid,targetOid);
       await fixtureGit(f.directory,root(guard),'read-tree','-u','-m',targetOid,integratedOid);
       history.transaction(()=>{
         const done=history.prepare(`INSERT INTO workflow_operations(request_id,namespace,action,payload_hash,canonical_intent,owner_uid,
           owning_instance_id,phase,outcome,target_id,accepted_at,completed_at) VALUES(?,'REVIEW',?,?,?,?,?,'FINALIZED','SUCCEEDED',?,?,?)`);
         done.run(decisionId,'approve',candidate.digest,JSON.stringify({payload:{evidenceDigest:candidate.digest}}),process.getuid!(),
           paused.result.instanceId,ids.review,at,at);
         done.run(integrationId,'integrate',candidate.digest,'{}',process.getuid!(),paused.result.instanceId,candidateId,at,at);
         history.prepare("INSERT INTO review_decisions VALUES(?,?,?,?,'APPROVE_INTEGRATION',NULL,?)")
           .run(decisionId,ids.review,candidateId,candidate.digest,at);
         history.prepare("INSERT INTO review_integrations VALUES(?,?,?,?,?,?,'FINALIZED',?,?)")
           .run(integrationId,candidateId,decisionId,candidate.repository_key,targetRef,targetOid,integratedOid,
             JSON.stringify({requestId:integrationId,old:targetOid,candidate:integratedOid,guardSynced:true}));
         history.prepare("UPDATE review_records SET state='APPROVED',state_revision=state_revision+1 WHERE review_id=?").run(ids.review);
       })();
     }finally{history.close();}
     await promisify(execFile)(process.execPath,[actor,f.archive],{timeout:35000,maxBuffer:16384});
     await panel.getByRole('button',{name:'Aggiorna revisioni'}).click();
     await panel.getByRole('button',{name:'Aggiorna dettaglio'}).click();
     const complete=panel.getByRole('button',{name:'Concludi revisione'});
     await complete.click();
     await expect(page.getByRole('dialog')).toContainText(integratedOid);
     await page.keyboard.press('Escape');await expect(complete).toBeFocused();
     await complete.click();await page.getByRole('button',{name:'Conferma operazione',exact:true}).click();
     const completion=panel.getByRole('region',{name:'Ricevuta di integrazione'});
     await expect(completion.getByText('REVIEW.md',{exact:true})).toBeVisible();
     const completed=await f.cli(['review','receipt',integrationId]);
     const completionId=(await receipt.textContent())?.match(/[a-f0-9-]{36}/)?.[0];
     expect(completionId).toBeTruthy();
     expect(completed.result.data.receipt).toMatchObject({receiptId:completionId,integrationId,resultingOid:integratedOid,publicationGrantRequired:true});
     const checkCleanup=completion.getByRole('button',{name:'Verifica rimozione worktree'});
     await checkCleanup.click();
     const prepareCleanup=completion.getByRole('button',{name:'Prepara rimozione worktree'});
     await prepareCleanup.click();
     await expect(page.getByRole('dialog')).toContainText(workspaceId);
     await page.keyboard.press('Escape');await expect(prepareCleanup).toBeFocused();
     expect((await f.cli(['daemon','stop'])).result.outcome).toBe('SUCCEEDED');
     await panel.getByRole('button',{name:'Aggiorna dettaglio'}).click();
     await expect(panel.getByText(/Servizio offline/)).toBeVisible();
     await expect(prepare).toHaveCount(0);
     await expect(completion.getByText('REVIEW.md',{exact:true})).toBeVisible();
     await expect(checkCleanup).toBeDisabled();
   }finally{await app.close();}
 }finally{await f.cleanup();}
});
