import {test,expect} from '@playwright/test';
import {createScratch} from '../fixtures/desktop.ts';
import {launchDesktop, switchArchiveForRegression } from '../fixtures/electron.ts';

test('sessions stays available offline and does not enable unqualified start',async()=>{
 const first=await createScratch(),other=await createScratch();
 try{
   const repo=await first.repository('execution-local');
   expect((await first.cli(['daemon','start'])).result.outcome).toBe('SUCCEEDED');
   expect((await first.cli(['project','add',repo.path])).result.outcome).toBe('SUCCEEDED');
   const {app,page}=await launchDesktop(first);
   try{
     await page.locator('.project-row').first().click();
     const nav=page.getByRole('button',{name:'Sessioni',exact:true});
     await nav.click();
     const panel=page.getByRole('region',{name:'Sessioni agente'});
     await expect(panel.getByText('Nessuna sessione per questo progetto.')).toBeVisible();
     await expect(panel.getByRole('button',{name:'Nuova sessione'})).toBeDisabled();
     expect((await first.cli(['daemon','stop'])).result.outcome).toBe('SUCCEEDED');
     await panel.getByRole('button',{name:'Aggiorna',exact:true}).click();
     await expect(panel.getByText(/Servizio offline/)).toBeVisible();
     await expect(panel.getByRole('button',{name:'Nuova sessione'})).toBeDisabled();
     await switchArchiveForRegression(app,page,other.directory);
     await expect(page.getByText('execution-local',{exact:true})).toHaveCount(0);
   }finally{await app.close();}
 }finally{await Promise.all([first.cleanup(),other.cleanup()]);}
});

test('session reconciliation confirms the exact receipt and restores keyboard focus',async()=>{
 const f=await createScratch();
 try{
   const {openOwnedWorktree}=await import('../fixtures/owned-worktree.ts');
   const {app,page,workspaceId}=await openOwnedWorktree(f);
   try{
     const {randomUUID}=await import('node:crypto');
     const {join}=await import('node:path');
     const {default:Database}=await import('better-sqlite3');
     const stopped=await f.cli(['daemon','stop']);
     expect(stopped.result.outcome).toBe('SUCCEEDED');
     const instanceId=stopped.result.instanceId as string;
     const db=new Database(join(f.archive,'state.sqlite'));
     const sessionId=randomUUID(),profileResolutionId=randomUUID(),at=new Date().toISOString(),hash='e'.repeat(64);
     try{
       db.pragma('foreign_keys=ON');
       const workspace=db.prepare('SELECT feature_id,project_id,envelope_id FROM workspaces_records WHERE workspace_id=?').get(workspaceId) as
         {feature_id:string;project_id:string;envelope_id:string};
       const role=db.prepare("SELECT entity_id,revision_id FROM profiles_records WHERE alias='backend'").get() as {entity_id:string;revision_id:string};
       db.transaction(()=>{
         function operation(id:string,namespace:string,action:string,phase:string,outcome:string,target:string,result:unknown){
           db.prepare(`INSERT INTO workflow_operations(request_id,namespace,action,payload_hash,canonical_intent,owner_uid,owning_instance_id,
             phase,outcome,target_id,accepted_at,completed_at,result) VALUES(?,?,?,?,'{}',?,?,?,?,?,?,?,?)`)
             .run(id,namespace,action,hash,process.getuid!(),instanceId,phase,outcome,target,at,phase==='FINALIZED'?at:null,JSON.stringify(result));
         }
         operation(profileResolutionId,'PROFILE','resolve','FINALIZED','SUCCEEDED',role.entity_id,{resolutionId:profileResolutionId});
         db.prepare('INSERT INTO profiles_resolutions VALUES(?,?,?,?,1,?,?,?,\'[]\',?)')
           .run(profileResolutionId,role.entity_id,role.revision_id,workspace.project_id,hash,hash,'{}',at);
         operation(sessionId,'EXECUTION','start','WORKING','UNKNOWN',workspace.feature_id,{sessionId,runId:sessionId});
         db.prepare("INSERT INTO execution_sessions VALUES(?,?,?,?,?,'RECONCILING',2,?,NULL,?,?,?)")
           .run(sessionId,workspace.feature_id,workspaceId,workspace.project_id,profileResolutionId,sessionId,workspace.envelope_id,at,at);
         db.prepare(`INSERT INTO execution_runs(run_id,session_id,generation,instance_id,provider_id,config_revision,capability_digest,input_digest,phase,outcome)
            VALUES(?,?,?,?,'codex',1,?,?,'RUNNING','UNKNOWN')`).run(sessionId,sessionId,randomUUID(),instanceId,hash,hash);
       })();
     }finally{db.close();}
     expect((await f.cli(['daemon','start'])).result.outcome).toBe('SUCCEEDED');
     await page.getByRole('button',{name:'Sessioni',exact:true}).click();
     const session=page.getByRole('region',{name:'Sessioni agente'});
     await session.getByRole('button',{name:/Uscita da riconciliare/}).click();
     const reconcile=session.getByRole('button',{name:'Riconcilia',exact:true});
     await reconcile.click();
     await expect(page.getByRole('dialog')).toContainText(sessionId);
     await page.keyboard.press('Escape');
     await expect(reconcile).toBeFocused();
     await reconcile.click();
     await page.getByRole('button',{name:'Conferma operazione',exact:true}).click();
     await expect(session.getByRole('status')).toContainText('TERMINAL');
     expect((await f.cli(['daemon','stop'])).result.outcome).toBe('SUCCEEDED');
     await session.getByRole('button',{name:'Aggiorna',exact:true}).click();
     await expect(session.getByText(/Servizio offline/)).toBeVisible();
     await expect(reconcile).toBeDisabled();
   }finally{await app.close();}
 }finally{await f.cleanup();}
});
