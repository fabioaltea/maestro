import {test,expect} from '@playwright/test';
import {createScratch} from '../fixtures/desktop.ts';
import {chooseDirectory,launchDesktop} from '../fixtures/electron.ts';

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
     expect((await f.cli(['daemon','stop'])).result.outcome).toBe('SUCCEEDED');
     await panel.getByRole('button',{name:'Aggiorna revisioni'}).click();
     await expect(panel.getByText(/Servizio offline/)).toBeVisible();
     await chooseDirectory(app,other.directory);await page.getByRole('button',{name:'Apri archivio',exact:true}).click();
     await expect(page.getByText('review-fixture',{exact:true})).toHaveCount(0);
   }finally{await app.close();}
 }finally{await Promise.all([f.cleanup(),other.cleanup()]);}
});
