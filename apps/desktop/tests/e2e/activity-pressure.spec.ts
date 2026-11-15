import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createScratch, repositoryRoot } from '../fixtures/desktop.ts';
import { launchDesktop, chooseDirectory } from '../fixtures/electron.ts';
import { watchVisible, visibleSamples, p95 } from '../fixtures/activity-metrics.ts';
test.use({trace:'off'});
const report=join(repositoryRoot,'specs/003-desktop-core-ui/reports');
test('separate real core stream load reports reference pipe availability to visible commit',async()=>{
 test.setTimeout(90000);const f=await createScratch();let child:ReturnType<typeof spawn>|undefined;try{
  await f.cli(['daemon','start']);const history=(await f.cli(['daemon','events'])).result,after=history.data.events.cursor;
  const {app,page}=await launchDesktop(f);try{
   await chooseDirectory(app,f.archive);await page.getByRole('button',{name:'Apri archivio',exact:true}).click();await page.getByRole('button',{name:'Attività',exact:true}).click();await expect(page.locator('.event-row').first()).toBeVisible();await watchVisible(page);
   const available:{seq:string;availableAt:number}[]=[];let pending='';child=spawn(process.execPath,[join(repositoryRoot,'dist/cli/main.js'),'daemon','events','--follow','--json',`--after=${after}`,`--state-dir=${f.archive}`],{stdio:['ignore','pipe','pipe']});
   let started=false;child.stdout!.on('data',chunk=>{pending+=String(chunk);for(;;){const n=pending.indexOf('\n');if(n<0)break;const frame=JSON.parse(pending.slice(0,n));pending=pending.slice(n+1);if(frame.kind==='subscription.started')started=true;if(frame.kind==='event')available.push({seq:frame.event.seq,availableAt:Date.now()});}});
   await expect.poll(()=>started).toBe(true);await page.getByRole('button',{name:'Segui attività',exact:true}).click();await expect(page.getByText('Osservazione live',{exact:true})).toBeVisible();const begin=Date.now();
   for(let i=0;i<10;i++){await page.getByRole('button',{name:'Diagnostica',exact:true}).focus();await expect(page.getByRole('button',{name:'Diagnostica',exact:true})).toBeFocused();const repo=await f.repository(`real-${i}`);await f.cli(['project','add',repo.path]);}
   await expect.poll(()=>page.locator('.event-row').count()).toBeGreaterThan(history.data.events.records.length+19);
   const visible=await visibleSamples(page),bySeq=new Map(visible.map(s=>[s.seq,s.visibleAt]));const samples=available.map(s=>({...s,visibleAt:bySeq.get(s.seq),signedLatencyMs:(bySeq.get(s.seq)??Infinity)-s.availableAt}));
   expect(samples.length).toBeGreaterThanOrEqual(20);expect(samples.every(s=>Number.isFinite(s.signedLatencyMs))).toBe(true);
   await writeFile(join(report,'event-core-samples.json'),JSON.stringify({measuredAt:new Date().toISOString(),source:'real core CLI, independent reference pipe; signed deltas include observer scheduling uncertainty',registrations:10,durationMs:Date.now()-begin,events:samples.length,p95Ms:p95(samples.map(s=>s.signedLatencyMs)),maxMs:Math.max(...samples.map(s=>s.signedLatencyMs)),samples},null,2)+'\n');
   expect(p95(samples.map(s=>s.signedLatencyMs))).toBeLessThanOrEqual(1000);
  }finally{await app.close();}
 }finally{if(child&&child.exitCode===null&&child.signalCode===null){const closed=once(child,'close');child.kill('SIGTERM');await closed;}await f.cleanup();}
});
