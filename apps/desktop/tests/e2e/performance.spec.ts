import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createScratch, repositoryRoot } from '../fixtures/desktop.ts';
import { launchDesktop } from '../fixtures/electron.ts';
import { p95 } from '../fixtures/activity-metrics.ts';
test('SC001/002: thirty actual window openings and thirty live/offline detail selections on 100 projects',async()=>{
 test.setTimeout(300000);const f=await createScratch();try{
  await f.cli(['daemon','start']);
  for(let start=0;start<100;start+=4)await Promise.all(Array.from({length:4},async(_,n)=>{const repo=await f.repository(`Performance ${String(start+n).padStart(3,'0')}`,false);expect((await f.cli(['project','add',repo.path])).result.outcome).toBe('SUCCEEDED');}));
  const openings:number[]=[],live:number[]=[],offline:number[]=[],observed:unknown[]=[];
  for(let i=0;i<30;i++){
   const {app,page,launchStarted}=await launchDesktop(f);try{
    // Conservative upper bound: timer precedes Electron process creation and window creation.
    // Native picker result is supplied immediately after bootstrap readiness.
    await expect(page.locator('.project-row')).toHaveCount(25);
    const elapsed=performance.now()-launchStarted;openings.push(elapsed);
    if(i===29){
     const home=page.getByRole('button',{name:'Chiudi repository',exact:true});
     for(let n=0;n<30;n++){
      if(n>0)await home.click();
      const row=page.locator('.project-row').nth(n%25),name=await row.locator('strong').textContent();const begin=performance.now();await row.click();await expect(page.getByRole('article',{name:`Dettaglio ${name}`})).toBeVisible();live.push(performance.now()-begin);await expect(page.getByText('Ultimo stato noto',{exact:false}).last()).toBeVisible();observed.push({mode:'live',name,historicalObservation:true});
     }
     await home.click();
     for(let p=1;p<=4;p++){
      await expect(page.locator('.project-row')).toHaveCount(p*25);
      if(p<4)await page.getByRole('button',{name:'Altri repository',exact:true}).click();
     }
     expect(new Set(await page.locator('.project-row strong').allTextContents()).size).toBe(100);
     await f.cli(['daemon','stop']);
     const before=await f.snapshot(f.archive);
     for(let n=0;n<30;n++){
      if(n>0)await home.click();
      const row=page.locator('.project-row').nth(n%25),name=await row.locator('strong').textContent(),begin=performance.now();await row.click();await expect(page.getByRole('article',{name:`Dettaglio ${name}`})).toBeVisible();offline.push(performance.now()-begin);await expect(page.getByText('Ultimo stato noto · servizio fermo',{exact:true})).toBeVisible();await expect(page.getByText('Ultimo stato noto',{exact:false}).last()).toBeVisible();observed.push({mode:'offline',name,historicalObservation:true});
     }expect(await f.snapshot(f.archive)).toEqual(before);
    }
   }finally{await app.close();}
  }
  const summary=(values:number[])=>({n:values.length,p95Ms:p95(values),maxMs:Math.max(...values)});
  const environment={os:(await promisify(execFile)('/usr/bin/sw_vers',['-productVersion'])).stdout.trim(),arch:process.arch,node:process.version,platform:process.platform,versions:'Electron45.3.0/React19.3.1',filesystem:'APFS',cache:'warm filesystem; fresh Electron process each opening; private archive bound at startup',baseline:'001+002 local main 72381375dcc31b54dcebf05666a0d7b4ab9c8ef3'};
  await writeFile(join(repositoryRoot,'specs/003-desktop-core-ui/reports/view-performance-samples.json'),JSON.stringify({measuredAt:new Date().toISOString(),environment,definition:{opening:'before Electron process launch to first interactive 25-row page (upper bound on window creation to ready); automatic private archive selection',detail:'before click to selected article ready; includes Playwright dispatch/expect overhead',percentile:'nearest rank'},openings,live,offline,observed,summary:{opening:summary(openings),live:summary(live),offline:summary(offline)}},null,2)+'\n');
  expect(p95(openings)).toBeLessThanOrEqual(2000);expect(p95(live)).toBeLessThanOrEqual(1000);expect(p95(offline)).toBeLessThanOrEqual(2000);
 }finally{await f.cleanup();}
});
