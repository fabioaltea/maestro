import {test,expect} from '@playwright/test';
import {createScratch} from '../fixtures/desktop.ts';
import {launchDesktop, openSetting} from '../fixtures/electron.ts';

test('the queue is visible online and offline without pretending an executor is configured',async()=>{
 const f=await createScratch();
 try{
   expect((await f.cli(['daemon','start'])).result.outcome).toBe('SUCCEEDED');
   const repo=await f.repository('coda');
   expect((await f.cli(['project','add',repo.path])).result.outcome).toBe('SUCCEEDED');
   const {app,page}=await launchDesktop(f);
   try{
     await page.locator('.project-row').first().click();
     await openSetting(page, 'Coda');
     const queue=page.getByRole('region',{name:'Coda sessioni'});
     await expect(queue.getByText('Nessun job in coda.')).toBeVisible();
     await expect(queue.getByText(/executor qualificato/)).toBeVisible();
     expect((await f.cli(['daemon','stop'])).result.outcome).toBe('SUCCEEDED');
     await queue.getByRole('button',{name:'Aggiorna coda'}).click();
     await expect(queue.getByText(/Servizio offline/)).toBeVisible();
   }finally{await app.close();}
 }finally{await f.cleanup();}
});
