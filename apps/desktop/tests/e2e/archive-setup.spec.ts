import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { access, mkdir } from 'node:fs/promises';
import { createScratch, repositoryRoot } from '../fixtures/desktop.ts';
import { launchDesktop, chooseDirectory } from '../fixtures/electron.ts';
test('first setup explains one archive to many repositories and imports two projects into the same archive',async()=>{
 test.setTimeout(60000);const f=await createScratch();try{
  const repos=await Promise.all([f.repository('Progetto uno'),f.repository('Progetto due')]),before=await Promise.all(repos.map(repo=>f.snapshot(repo.path)));
  const {app,page}=await launchDesktop(f);try{
   await expect(page.getByRole('heading',{name:'Un archivio, più progetti',exact:true})).toBeVisible();
   await expect(page.getByText('I file dei repository restano nelle loro cartelle.',{exact:true})).toBeVisible();
   const screenshots=join(repositoryRoot,'specs/003-desktop-core-ui/reports/screenshots');await mkdir(screenshots,{recursive:true});
   await expect(page.getByRole('button',{name:'Configura archivio Maestro',exact:true})).toBeInViewport();await page.screenshot({path:join(screenshots,'archive-intro.png')});
   await page.getByRole('button',{name:'Configura archivio Maestro',exact:true}).click();await page.getByLabel('Nome archivio',{exact:true}).fill('archive');await expect(page.getByRole('button',{name:'Scegli cartella contenitore',exact:true})).toBeInViewport();await page.screenshot({path:join(screenshots,'archive-setup.png')});
   await chooseDirectory(app,f.directory);await page.getByRole('button',{name:'Scegli cartella contenitore',exact:true}).click();
   await expect(page.getByRole('heading',{name:'Servizio locale',exact:true})).toBeVisible();await expect(page.getByText('Fermo',{exact:true})).toBeVisible();await expect(access(f.archive)).rejects.toThrow();
   await page.getByRole('button',{name:'Avvia servizio',exact:true}).click();await page.getByRole('button',{name:'Conferma operazione',exact:true}).click();await expect(page.getByText('Attivo',{exact:true})).toBeVisible();
   await page.getByRole('button',{name:'Progetti',exact:true}).click();
   for(let i=0;i<repos.length;i++){
    await page.getByRole('button',{name:'Importa progetto',exact:true}).click();await chooseDirectory(app,repos[i]!.path);await page.getByRole('button',{name:'Scegli repository',exact:true}).click();
    await page.getByLabel('Nome progetto (facoltativo)',{exact:true}).fill(`Progetto ${i+1}`);await page.getByRole('button',{name:'Rivedi importazione',exact:true}).click();await page.getByRole('button',{name:'Conferma operazione',exact:true}).click();
    await expect(page.getByRole('heading',{name:`Progetto ${i+1}`,exact:true})).toBeVisible();
   }
   expect((await f.cli(['project','list'])).result.data.projects).toHaveLength(2);await expect(page.locator('.project-row')).toHaveCount(2);
   for(let i=0;i<repos.length;i++)expect(await f.snapshot(repos[i]!.path)).toEqual(before[i]);
  }finally{await app.close();}
 }finally{await f.cleanup();}
});
test('wrong repository selection keeps the previous archive and explains how to import without altering files',async()=>{
 const f=await createScratch();try{
  await f.cli(['daemon','start']);await f.cli(['daemon','stop']);const repo=await f.repository(),before=await f.snapshot(repo.path),archiveBefore=await f.snapshot(f.archive);
  const {app,page}=await launchDesktop(f);try{
   await chooseDirectory(app,f.archive);await page.getByRole('button',{name:'Apri archivio',exact:true}).click();await expect(page.getByText('Servizio fermo',{exact:true})).toBeVisible();
   const initial=await page.evaluate(()=>window.maestro.context({bridgeVersion:1,callId:crypto.randomUUID(),selectionEpoch:0}));
   await chooseDirectory(app,repo.path);await page.getByRole('button',{name:'Apri archivio',exact:true}).click();
   await expect(page.getByRole('alert')).toContainText('Hai scelto un repository Git');await expect(page.getByRole('alert')).toContainText('Importa progetto');
   const after=await page.evaluate(()=>window.maestro.context({bridgeVersion:1,callId:crypto.randomUUID(),selectionEpoch:0}));expect(after.result).toEqual(initial.result);
   expect(await f.snapshot(repo.path)).toEqual(before);expect(await f.snapshot(f.archive)).toEqual(archiveBefore);
  }finally{await app.close();}
 }finally{await f.cleanup();}
});

test('canceling the native folder choice keeps the setup and existing selection without creating an archive',async()=>{
 const f=await createScratch();try{
  const {app,page}=await launchDesktop(f);try{
   await chooseDirectory(app,f.archive);await page.getByRole('button',{name:'Apri archivio',exact:true}).click();await expect(page.getByText('Servizio fermo',{exact:true})).toBeVisible();
   const initial=await page.evaluate(()=>window.maestro.context({bridgeVersion:1,callId:crypto.randomUUID(),selectionEpoch:0}));
   await page.getByRole('button',{name:'Nuovo archivio',exact:true}).click();await page.getByLabel('Nome archivio',{exact:true}).fill('altro-archivio');
   await app.evaluate(({dialog})=>{dialog.showOpenDialog=async()=>({canceled:true,filePaths:[]});});await page.getByRole('button',{name:'Scegli cartella contenitore',exact:true}).click();
   await expect(page.getByRole('button',{name:'Scegli cartella contenitore',exact:true})).toBeEnabled();await expect(page.getByLabel('Nome archivio',{exact:true})).toHaveValue('altro-archivio');
   const after=await page.evaluate(()=>window.maestro.context({bridgeVersion:1,callId:crypto.randomUUID(),selectionEpoch:0}));expect(after.result).toEqual(initial.result);
   await expect(access(f.archive)).rejects.toThrow();await expect(access(join(f.directory,'altro-archivio'))).rejects.toThrow();
   await page.getByRole('button',{name:'Annulla configurazione',exact:true}).click();await expect(page.getByRole('region',{name:'Registro progetti',exact:true})).toBeVisible();await expect(page.getByLabel('Nome archivio',{exact:true})).toHaveCount(0);
  }finally{await app.close();}
 }finally{await f.cleanup();}
});
