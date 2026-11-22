import { test, expect } from '@playwright/test';
import { access, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createScratch } from '../fixtures/desktop.ts';
import { launchDesktop, chooseDirectory, openSetting } from '../fixtures/electron.ts';

test('launch and canceled repository picker leave the private archive untouched',async()=>{
 const f=await createScratch();
 try{
   const {app,page}=await launchDesktop(f);
   try{
     const open=page.getByRole('button',{name:'Apri repository'});
     await expect(open).toBeEnabled();
     await app.evaluate(({dialog})=>{dialog.showOpenDialog=async()=>({canceled:true,filePaths:[]});});
     await open.focus();
     await page.keyboard.press('Enter');
     await expect(open).toBeEnabled();
     await expect(access(f.archive)).rejects.toThrow();
     expect((await f.cli(['daemon','status'])).result.liveness).toBe('ABSENT_VERIFIED');
   }finally{await app.close();}
 }finally{await f.cleanup();}
});

test('diagnostics adopts the stopped original and exposes its projects in an empty profile',async()=>{
 const f=await createScratch();
 try{
   const repo=await f.repository('Storico');
   await f.cli(['daemon','start']);
   await f.cli(['project','add',repo.path]);
   await f.cli(['daemon','stop']);
   await mkdir(join(f.directory,'profile'),{mode:0o700});
   const archiveBefore=await f.snapshot(f.archive),{app,page}=await launchDesktop(f,null);
   try{
     await openSetting(page, 'Diagnostica');
     await page.getByText('Recupero dello storico',{exact:true}).click();
     await chooseDirectory(app,f.archive);
     await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:0,checkboxChecked:false});});
     await page.getByRole('button',{name:'Recupera storico'}).click();
     await expect(page.getByRole('alert')).toContainText('Storico recuperato');
     await page.getByRole('navigation',{name:'Sezioni repository'}).getByRole('button',{name:'Recenti',exact:true}).click();
     await page.getByRole('button',{name:/^Storico /}).click();
     await expect(page.getByRole('article',{name:'Dettaglio Storico'})).toBeVisible();
     await expect(page.getByText('Ultimo stato noto · servizio fermo')).toBeVisible();
     expect(await f.snapshot(f.archive)).toEqual(archiveBefore);
   }finally{await app.close();}
 }finally{await f.cleanup();}
});
