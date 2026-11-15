import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createScratch } from '../fixtures/desktop.ts';
import { launchDesktop, chooseDirectory } from '../fixtures/electron.ts';
for(const expired of [false,true])test(`explicit replay after real daemon restart; expired history=${expired}`,async()=>{
 const f=await createScratch();try{
  await f.cli(['daemon','start']);const {app,page}=await launchDesktop(f);let closed=false;try{
   await chooseDirectory(app,f.archive);await page.getByRole('button',{name:'Scegli archivio',exact:true}).click();await page.getByRole('button',{name:'Attività',exact:true}).click();
   await expect(page.locator('.event-row').first()).toBeVisible();await page.getByRole('button',{name:'Segui attività',exact:true}).click();await expect(page.getByText('Osservazione live',{exact:true})).toBeVisible();
   await page.getByRole('button',{name:'Interrompi osservazione',exact:true}).click();
   await f.cli(['daemon','stop']);
   let floor='1';
   if(expired){const history=(await f.cli(['daemon','events'])).result;floor=history.data.events.highWater;
    // Test-only controlled retention boundary in an owned, stopped archive; production UI never writes it.
    await writeFile(join(f.archive,'events/retention.json'),JSON.stringify({storeId:history.storeId,firstAvailable:floor}),{mode:0o600});}
   await f.cli(['daemon','start']);await page.getByRole('button',{name:'Riconnetti',exact:true}).click();
   if(expired){await expect(page.getByText(/Continuità non verificata/)).toBeVisible();await expect(page.getByText(/CURSOR_EXPIRED/)).toBeVisible();
    await page.getByRole('button',{name:'Rileggi stato e storia',exact:true}).click();await expect(page.getByText(/Nuova finestra di storia/)).toBeVisible();
    await expect.poll(async()=>BigInt((await page.locator('.event-row').last().getAttribute('data-event-seq'))!)).toBeGreaterThanOrEqual(BigInt(floor));
    await page.getByRole('button',{name:'Segui attività',exact:true}).click();
   }
   await expect(page.getByText('Osservazione live',{exact:true})).toBeVisible();const repo=await f.repository('replay');await f.cli(['project','add',repo.path]);
   await expect(page.locator('.event-row').filter({hasText:'REGISTER'}).first()).toBeAttached();
   const seqs=await page.locator('.event-row').evaluateAll(rows=>rows.map(r=>r.getAttribute('data-event-seq')));expect(new Set(seqs).size).toBe(seqs.length);
   await app.close();closed=true;expect((await f.cli(['daemon','status'])).result.liveness).toBe('LIVE_VERIFIED');
  }finally{if(!closed)await app.close();}
 }finally{await f.cleanup();}
});
