import {test,expect} from '@playwright/test';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createScratch} from '../fixtures/desktop.ts';
import {seedWaitingDiscovery} from '../fixtures/discovery-session.ts';

import {chooseDirectory,launchDesktop} from '../fixtures/electron.ts';

test('shows the README before its metadata in the repository overview',async()=>{
 test.setTimeout(60_000);
 const f=await createScratch();
 try{
   const repo=await f.repository('Anteprima documentazione');
   const readmePath=join(repo.path,'README.md');
   await writeFile(readmePath,'# Guida del progetto\n\nContenuto del README.\n');
   await repo.git(['add','--','README.md']);
   await repo.git(['commit','-m','Aggiungi guida iniziale']);
   const {app,page}=await launchDesktop(f);
   try{
     await chooseDirectory(app,repo.path);
     await page.getByRole('button',{name:'Apri repository',exact:true}).click();
     const readme=page.getByRole('region',{name:'README',exact:true});
     const title=readme.getByRole('heading',{name:'Guida del progetto',exact:true});
     const body=readme.getByText('Contenuto del README.',{exact:true});
     const modified=readme.getByText('Ultima modifica locale',{exact:true});
     const commit=readme.getByText('Ultimo commit del README',{exact:true});
     await expect(title).toBeInViewport();
     await expect(body).toBeVisible();
     await expect(readme.getByRole('heading')).toHaveCount(1);
     await expect(modified).toBeVisible();
     await expect(commit).toBeVisible();
     await expect(readme.getByText('Aggiungi guida iniziale',{exact:true})).toBeVisible();
     const bodyBox=(await body.boundingBox())!;
     for(const label of [modified,commit]){
       expect((await label.boundingBox())!.y).toBeGreaterThanOrEqual(bodyBox.y+bodyBox.height);
     }
     const detail=page.getByRole('article',{name:'Dettaglio Anteprima documentazione'});
     await expect(detail.getByRole('button')).toHaveText(['Chiudi repository']);
   }finally{await app.close();}
 }finally{await f.cleanup();}
});

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
     const home = page.getByRole('button',{name:'Chiudi repository',exact:true});
     await home.click();
     const target=join(f.directory,'nuovo'),create=page.getByRole('button',{name:'Crea repository'});
     await mkdir(target);
     await chooseDirectory(app,target);
     await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:0,checkboxChecked:false});});
     await create.click();
     await expect(page.getByRole('article',{name:'Dettaglio nuovo'})).toBeVisible();
     expect((await readFile(join(target,'.git','HEAD'),'utf8')).trim()).toEqual('ref: refs/heads/main');
     await home.click();
     await page.getByRole('button',{name:/checkout esistente/}).click();
     await expect(page.getByRole('article',{name:'Dettaglio checkout esistente'})).toBeVisible();
     const samples=[];
     for(let index=0;index<10;index++){
       const name=index%2===0?'nuovo':'checkout esistente';
       await home.click();
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
     await page.getByRole('button',{name:'Feature',exact:true}).click();
     const next=page.getByRole('button',{name:'Prepara creazione',exact:true});
     await expect(next).toBeDisabled();
     await page.getByRole('button',{name:'Analizza codebase'}).click();
     const review=page.locator('.discovery-review');
     await expect(review.getByRole('checkbox')).toHaveCount(3,{timeout:15_000});
     for(const field of await review.getByRole('checkbox').all())await field.check();
     await review.getByRole('button',{name:'Approva questa revisione'}).click();
     await page.getByRole('button',{name:'Conferma operazione',exact:true}).click();
     await expect(review).toContainText('Approvazione storica:',{timeout:15_000});
     await page.getByRole('button',{name:'Feature',exact:true}).click();
     await expect(next).toBeEnabled({timeout:15_000});
     const editor=page.getByLabel('Specifica e piano JSON');
     await expect(editor).toBeVisible();
     await expect(page.getByRole('article',{name:'Dettaglio Intervista UI'})).toContainText(seed.repo.path);
     await writeFile(join(seed.repo.path,'file.txt'),'Contesto modificato.\n');
     await page.getByRole('button',{name:'Panoramica',exact:true}).click();
     await page.getByRole('button',{name:'Chiudi repository',exact:true}).click();
     await page.getByRole('button',{name:/^Intervista UI /}).click();
     await page.getByRole('button',{name:'Feature',exact:true}).click();
     await expect(page.getByText('Aggiorna e approva l’analisi della codebase.')).toBeVisible();
     await expect(next).toBeDisabled();
     await page.getByRole('button',{name:'Panoramica',exact:true}).click();
     await page.getByRole('button',{name:'Chiudi repository',exact:true}).click();
     await chooseDirectory(app,other.path);
     await page.getByRole('button',{name:'Apri repository'}).click();
     await expect(page.getByRole('article',{name:'Dettaglio Altro progetto'})).toBeVisible();
     await expect(editor).toHaveCount(0);
     await page.getByRole('button',{name:'Feature',exact:true}).click();
     await expect(next).toBeDisabled();
   }finally{await app.close();}
 }finally{await f.cleanup();}
});
