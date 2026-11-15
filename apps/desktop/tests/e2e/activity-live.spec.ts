import { test, expect } from '@playwright/test';
import { createScratch } from '../fixtures/desktop.ts';
import { launchDesktop, chooseDirectory } from '../fixtures/electron.ts';
test('activity follows real CLI events and unsubscribe preserves service',async()=>{
 const f=await createScratch();try{
  await f.cli(['daemon','start']);const{app,page}=await launchDesktop(f);try{
   await chooseDirectory(app,f.archive);await page.getByRole('button',{name:'Apri archivio',exact:true}).click();
   await page.getByRole('button',{name:'Attività',exact:true}).click();await expect(page.locator('.event-row').first()).toBeVisible();
   const before=await page.locator('.event-row').count();await page.getByRole('button',{name:'Segui attività',exact:true}).click();await expect(page.getByText('Osservazione live',{exact:true})).toBeVisible();
   const repo=await f.repository('ui-live');await f.cli(['project','add',repo.path]);
   await expect.poll(()=>page.locator('.event-row').count()).toBeGreaterThan(before);
   await page.getByRole('button',{name:'Interrompi osservazione',exact:true}).click();
   await expect(page.getByText('Osservazione interrotta',{exact:true})).toBeVisible();expect((await f.cli(['daemon','status'])).result.liveness).toBe('LIVE_VERIFIED');
  }finally{await app.close();}
 }finally{await f.cleanup();}
});
