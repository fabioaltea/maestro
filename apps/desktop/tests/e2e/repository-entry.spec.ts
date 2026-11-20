import {test,expect} from '@playwright/test';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createScratch} from '../fixtures/desktop.ts';
import {seedWaitingDiscovery} from '../fixtures/discovery-session.ts';

import {chooseDirectory,launchDesktop} from '../fixtures/electron.ts';

test('opens and creates repositories from a fresh Desktop profile',async({},testInfo)=>{
 test.setTimeout(60_000);
 const f=await createScratch();
 try{
   const existing=await f.repository('checkout esistente'),initial=await f.snapshot(existing.path);
   const {app,page}=await launchDesktop(f);
   try{
     await expect(page.getByRole('button',{name:'Apri archivio',exact:true})).toHaveCount(0);
     const open=page.getByRole('button',{name:'Apri repository',exact:true});
     await chooseDirectory(app,existing.path);
     await open.click();
     await expect(page.getByRole('article',{name:'Dettaglio checkout esistente'})).toBeVisible();
     await expect(page.getByRole('button',{name:'Analizza codebase'})).toBeVisible();
     expect(await f.snapshot(existing.path)).toEqual(initial);
     const target=join(f.directory,'nuovo'),create=page.getByRole('button',{name:'Crea repository'});
     await mkdir(target);
     await chooseDirectory(app,target);
     await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:0,checkboxChecked:false});});
     await create.click();
     await expect(page.getByRole('article',{name:'Dettaglio nuovo'})).toBeVisible();
     expect((await readFile(join(target,'.git','HEAD'),'utf8')).trim()).toEqual('ref: refs/heads/main');
     await page.getByRole('button',{name:/checkout esistente/}).click();
     await expect(page.getByRole('article',{name:'Dettaglio checkout esistente'})).toBeVisible();
     const samples=[];
     for(let index=0;index<10;index++){
       const name=index%2===0?'nuovo':'checkout esistente';
       const started=performance.now();
       await page.getByRole('button',{name:new RegExp(`^${name} `)}).click();
       await expect(page.getByRole('article',{name:`Dettaglio ${name}`})).toBeVisible();
       samples.push(performance.now()-started);
     }
     expect(samples.filter(value=>value<=2000).length).toBeGreaterThanOrEqual(9);
     await testInfo.attach('warm-open-ms',{body:JSON.stringify(samples),contentType:'application/json'});
     expect((await f.cli(['project','list'])).result.data.projects).toHaveLength(2);
     expect(await f.snapshot(existing.path)).toEqual(initial);
   }finally{await app.close();}
 }finally{await f.cleanup();}
});

test('five existing and five new repositories reach analysis with an initially empty archive',async()=>{
 test.setTimeout(180_000);
 for(let index=0;index<10;index++){
   const f=await createScratch();
   try{
     const name=`Prova ${index}`,existing=index<5;
     const path=existing?(await f.repository(name,index%2===0)).path:join(f.directory,name);
     if(!existing)await mkdir(path);
     const {app,page}=await launchDesktop(f);
     try{
       expect((await f.cli(['daemon','status'])).result.liveness).toBe('ABSENT_VERIFIED');
       await chooseDirectory(app,path);
       if(!existing)await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:0,checkboxChecked:false});});
       await page.getByRole('button',{name:existing?'Apri repository':'Crea repository',exact:true}).click();
       await expect(page.getByRole('article',{name:`Dettaglio ${name}`})).toBeVisible();
       await expect(page.getByRole('button',{name:'Analizza codebase'})).toBeVisible();
     }finally{await app.close();}
   }finally{await f.cleanup();}
 }
});

test('routes an approved analysis to a new feature for the same repository',async()=>{
 test.setTimeout(60_000);
 const f=await createScratch();
 try{
   const seed=await seedWaitingDiscovery(f,true), other=await f.repository('Altro progetto');
   const {app,page}=await launchDesktop(f);
   try{
     await page.getByRole('button',{name:/Intervista UI/}).click();
     const next=page.getByRole('button',{name:'Nuova feature',exact:true});
     await expect(next).toBeDisabled();
     await page.getByRole('button',{name:'Analizza codebase'}).click();
     const review=page.locator('.discovery-review');
     await expect(review.getByRole('checkbox')).toHaveCount(3);
     for(const field of await review.getByRole('checkbox').all())await field.check();
     await review.getByRole('button',{name:'Approva questa revisione'}).click();
     await page.getByRole('button',{name:'Conferma operazione',exact:true}).click();
     await expect(next).toBeEnabled({timeout:15_000});
     await next.click();
     const editor=page.getByLabel('Specifica e piano JSON');
     await expect(editor).toBeVisible();
     await expect(page.getByRole('article',{name:'Dettaglio Intervista UI'})).toContainText(seed.repo.path);
     await writeFile(join(seed.repo.path,'file.txt'),'Contesto modificato.\n');
     await page.getByRole('button',{name:'Aggiorna repository',exact:true}).click();
     await expect(page.getByText('Aggiorna e approva l’analisi della codebase.')).toBeVisible();
     await expect(next).toBeDisabled();
     await expect(page.getByRole('button',{name:'Prepara creazione',exact:true})).toBeDisabled();
     await chooseDirectory(app,other.path);
     await page.getByRole('button',{name:'Apri repository'}).click();
     await expect(page.getByRole('article',{name:'Dettaglio Altro progetto'})).toBeVisible();
     await expect(next).toBeDisabled();
     await expect(editor).toHaveCount(0);
   }finally{await app.close();}
 }finally{await f.cleanup();}
});
