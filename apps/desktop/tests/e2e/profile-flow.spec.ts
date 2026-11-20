import {randomUUID} from 'node:crypto';

import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {test,expect} from '@playwright/test';
import {createScratch} from '../fixtures/desktop.ts';
import {chooseDirectory,launchDesktop, switchArchiveForRegression } from '../fixtures/electron.ts';

test('agent profiles create revisioned catalogue entries with confirmed receipts and offline history',async()=>{
 const f=await createScratch(),other=await createScratch();
 try{
   expect((await f.cli(['daemon','start'])).result.outcome).toBe('SUCCEEDED');
   const {app,page}=await launchDesktop(f);
   try{
     await page.getByRole('button',{name:'Profili agente',exact:true}).click();
     const panel=page.getByRole('region',{name:'Catalogo profili agente'});
     await expect(panel.getByRole('button',{name:'project-architect',exact:true})).toBeVisible();
     await panel.getByRole('button',{name:'Nuovo profilo'}).click();
     await panel.getByLabel('Alias',{exact:true}).fill('fixture-review');
     await panel.getByLabel('Nome',{exact:true}).fill('Revisione fixture');
     await panel.getByLabel('Ruolo',{exact:true}).fill('Reviewer');
     await panel.getByLabel('Istruzioni',{exact:true}).fill('Testo senza autorità implicita.');
     const prepare=panel.getByRole('button',{name:'Prepara salvataggio'});
     await prepare.click();await expect(page.getByRole('dialog')).toContainText('fixture-review');
     await page.keyboard.press('Escape');await expect(prepare).toBeFocused();
     await prepare.click();await page.getByRole('button',{name:'Conferma operazione',exact:true}).click();
     await expect(panel.getByRole('heading',{name:'Revisione fixture'})).toBeVisible();
     await expect(panel.getByText(/Operazione [a-f0-9-]{36}/)).toContainText('TERMINAL');
     expect((await f.cli(['daemon','stop'])).result.outcome).toBe('SUCCEEDED');
     await page.getByRole('button',{name:'Servizio',exact:true}).click();
     await page.getByRole('button',{name:'Profili agente',exact:true}).click();
     await expect(panel.getByText(/Ultimo stato noto/)).toBeVisible();
     await expect(panel.getByRole('button',{name:'fixture-review',exact:true})).toBeVisible();
     await expect(panel.getByRole('button',{name:'Nuovo profilo'})).toBeDisabled();
     await switchArchiveForRegression(app,page,other.directory);
     await expect(panel.getByRole('button',{name:'fixture-review',exact:true})).toHaveCount(0);
   }finally{await app.close();}
 }finally{await Promise.all([f.cleanup(),other.cleanup()]);}
});

test('desktop previews and binds a local skill after explicit review',async()=>{
 const f=await createScratch();
 try{
   const source=join(f.directory,'fixture-skill');await mkdir(source,{mode:0o700});
   await writeFile(join(source,'SKILL.md'),'# Fixture skill\nTesto locale.');
   expect((await f.cli(['daemon','start'])).result.outcome).toBe('SUCCEEDED');
   const {app,page}=await launchDesktop(f);
   try{
     await page.getByRole('button',{name:'Profili agente',exact:true}).click();
     const panel=page.getByRole('region',{name:'Catalogo profili agente'});
     await panel.getByRole('button',{name:'Skill',exact:true}).click();
     await chooseDirectory(app,source);
     await panel.getByRole('button',{name:'Scegli cartella skill'}).click();
     const review=panel.getByRole('region',{name:'Anteprima skill'});
     await expect(review).toContainText('SKILL.md');await expect(review).not.toContainText(source);
     await review.getByRole('button',{name:'Prepara import skill'}).click();
     await expect(page.getByRole('dialog')).toContainText('fixture-skill');
     await page.getByRole('button',{name:'Conferma operazione',exact:true}).click();
     await expect(panel.getByRole('button',{name:'fixture-skill',exact:true})).toBeVisible();
     await panel.getByRole('button',{name:'Profili',exact:true}).click();
     await panel.getByRole('button',{name:'reviewer',exact:true}).click();
     await panel.getByRole('button',{name:'Associa skill'}).click();
     const associations=panel.getByRole('region',{name:'Associazioni skill'});
     await associations.getByRole('combobox',{name:'fixture-skill · GLOBAL'}).selectOption('requiredRefs');
     await associations.getByRole('button',{name:'Prepara associazioni'}).click();
     await page.getByRole('button',{name:'Conferma operazione',exact:true}).click();
     await expect(panel.getByRole('region',{name:'Dettaglio profilo'})).toContainText('Revisione2');
     const profiles=(await f.cli(['profile','list','PROFILE'])).result.data.items;
     const owner=profiles.find((item:any)=>item.alias==='reviewer');
     const result=(await f.cli(['profile','show',owner.entityId])).result.data;
     expect(result.revision.document.requiredRefs).toHaveLength(1);
   }finally{await app.close();}
 }finally{await f.cleanup();}
});

test('desktop reviews, enables and revokes a local tool manifest as catalogue data',async()=>{
 const f=await createScratch();
 try{
   expect((await f.cli(['daemon','start'])).result.outcome).toBe('SUCCEEDED');
   const {app,page}=await launchDesktop(f);
   try{
     await page.getByRole('button',{name:'Profili agente',exact:true}).click();
     const panel=page.getByRole('region',{name:'Catalogo profili agente'}),confirm=page.getByRole('button',{name:'Conferma operazione',exact:true});
     await panel.getByRole('button',{name:'Tool',exact:true}).click();
     await panel.getByLabel('Manifest JSON').fill(JSON.stringify({alias:'fixture-tool',title:'Tool fixture',version:'1.0.0',
       kind:'LOCAL_COMMAND',commandSpecId:randomUUID(),argvSchema:[],inputBytes:1024,outputBytes:4096,
       requiredPermissions:['TOOL_LOCAL'],credentialRequirements:[],networkScope:'OFFLINE'}));
     await panel.getByRole('button',{name:'Prepara import tool'}).click();
     await expect(page.getByRole('dialog')).toContainText('TOOL_LOCAL');await confirm.click();
     const detail=panel.getByRole('region',{name:'Dettaglio profilo'});
     await expect(detail.getByText('REVIEWED',{exact:true})).toBeVisible();
     await detail.getByRole('button',{name:'Prepara abilitazione tool'}).click();await confirm.click();
     await expect(detail.getByText('ENABLED',{exact:true})).toBeVisible();
     await detail.getByRole('button',{name:'Prepara disabilitazione'}).click();await confirm.click();
     await expect(detail.getByText('DISABLED',{exact:true})).toBeVisible();
   }finally{await app.close();}
 }finally{await f.cleanup();}
});
