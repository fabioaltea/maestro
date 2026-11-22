import { test, expect } from '@playwright/test';
import { createScratch } from '../fixtures/desktop.ts';
import { launchDesktop, openSetting } from '../fixtures/electron.ts';
test('persistent activity and diagnostics stay accessible after daemon stop without writes',async()=>{
 const f=await createScratch();try{
  await f.cli(['daemon','start']);const{app,page}=await launchDesktop(f);try{
   await openSetting(page, 'Attività');await expect(page.locator('.event-row').first()).toBeVisible();
   await f.cli(['daemon','stop']);const before=await f.snapshot(f.archive);
   await page.getByRole('button',{name:'Rileggi storia',exact:true}).click();await expect(page.getByText('Storia persistita del core · Ultimo stato noto',{exact:true})).toBeVisible();
   await openSetting(page, 'Diagnostica');await expect(page.locator('.diagnostics-data')).toContainText('observability');
   await expect(page.getByText('Ultimo stato noto · Servizio fermo',{exact:true})).toBeVisible();expect(await f.snapshot(f.archive)).toEqual(before);
  }finally{await app.close();}
 }finally{await f.cleanup();}
});
