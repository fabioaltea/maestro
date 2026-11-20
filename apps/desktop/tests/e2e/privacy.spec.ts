import { test, expect } from '@playwright/test';
import { readFile, readdir, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { createScratch } from '../fixtures/desktop.ts';
import { launchDesktop, switchArchiveForRegression } from '../fixtures/electron.ts';
test('renderer cannot inject paths/argv or bypass approval; credentials and raw output stay out of diagnostics and logs',async()=>{
 const f=await createScratch();try{
  await f.cli(['daemon','start']);const repo=await f.repository('PRIVATE_PATH_SENTINEL');await f.cli(['project','add',repo.path,'--name=PRIVATE_NAME_SENTINEL']);
  const {app,page}=await launchDesktop(f);try{
   await expect(page.locator('.project-row')).toHaveCount(1);
   const replies=await page.evaluate(async()=>{
    const ctx=await window.maestro.context({bridgeVersion:1,callId:crypto.randomUUID(),selectionEpoch:0}),epoch=(ctx.result as {context:{selectionEpoch:number}}).context.selectionEpoch;
    const envelope=()=>({bridgeVersion:1 as const,callId:crypto.randomUUID(),selectionEpoch:epoch});
    return await Promise.all([
     window.maestro.prepareAction({...envelope(),action:'project.register',params:{path:'/tmp/INJECTED',repositoryHandle:crypto.randomUUID()}}),
     window.maestro.prepareAction({...envelope(),action:'daemon.stop',params:{argv:['--force']}}),
     window.maestro.confirmAction({...envelope(),confirmationId:crypto.randomUUID()}),
     window.maestro.startEvents({...envelope(),afterApplied:'x'.repeat(40000)}),
     window.maestro.ackEvents({...envelope(),subscriptionId:crypto.randomUUID(),batchId:crypto.randomUUID(),lastAppliedSeq:'-1'}),
    ]);
   });expect(replies.every(r=>r.error!==null)).toBe(true);expect((await f.cli(['daemon','status'])).result.liveness).toBe('LIVE_VERIFIED');
   await page.getByRole('button',{name:'Diagnostica',exact:true}).click();await expect(page.locator('.diagnostics-data')).toBeVisible();expect(await page.locator('.diagnostics-data').textContent()).not.toMatch(/PRIVATE_PATH_SENTINEL|PRIVATE_NAME_SENTINEL|credentialRef|token|stderr/i);
   const entries=await readdir(f.archive);for(const name of entries.filter(n=>/credential|token/i.test(n))){const path=join(f.archive,name),stat=await lstat(path),files=stat.isDirectory()?(await readdir(path)).map(child=>join(path,child)):[path];for(const file of files){if(!(await lstat(file)).isFile())continue;const secret=await readFile(file,'utf8');if(secret.trim().length>10)expect((await page.content()).includes(secret.trim())).toBe(false);}}
   await f.cli(['daemon','stop']);const before=await f.snapshot(f.archive);const denied=await page.evaluate(async()=>{const ctx=await window.maestro.context({bridgeVersion:1,callId:crypto.randomUUID(),selectionEpoch:0});return window.maestro.prepareAction({bridgeVersion:1,callId:crypto.randomUUID(),selectionEpoch:(ctx.result as {context:{selectionEpoch:number}}).context.selectionEpoch,action:'daemon.stop',params:{}});});expect(denied.error).not.toBeNull();expect(await f.snapshot(f.archive)).toEqual(before);
  }finally{await app.close();}
  for(const name of await readdir(join(f.userData,'logs'))){const file=join(f.userData,'logs',name),stat=await lstat(file);expect(stat.size).toBeLessThanOrEqual(2*1024*1024);expect(await readFile(file,'utf8')).not.toMatch(/PRIVATE_PATH_SENTINEL|PRIVATE_NAME_SENTINEL|credential|token|stderr|\/archive|stack/i);}
 }finally{await f.cleanup();}
});
test('archive switch invalidates a prepared mutation and never redirects it into another store',async()=>{
 const f=await createScratch(),g=await createScratch();try{
  await f.cli(['daemon','start']);const repo=await f.repository();const added=(await f.cli(['project','add',repo.path,'--name=Originale'])).result;
  const {app,page}=await launchDesktop(f);try{
   await expect(page.locator('.project-row')).toHaveCount(1);
   const prepared=await page.evaluate(async id=>{const response=await window.maestro.context({bridgeVersion:1,callId:crypto.randomUUID(),selectionEpoch:0}),epoch=(response.result as {context:{selectionEpoch:number}}).context.selectionEpoch;
    return{epoch,reply:await window.maestro.prepareAction({bridgeVersion:1,callId:crypto.randomUUID(),selectionEpoch:epoch,action:'project.update',params:{projectId:id,expectedRevision:'1',patch:{name:'Da non applicare'}}})};},added.data.projectId);expect(prepared.reply.error).toBeNull();
   await switchArchiveForRegression(app,page,g.archive);
   const replies=await page.evaluate(async data=>{const context=await window.maestro.context({bridgeVersion:1,callId:crypto.randomUUID(),selectionEpoch:0}),epoch=(context.result as {context:{selectionEpoch:number}}).context.selectionEpoch,confirmationId=(data.reply.result as {confirmationId:string}).confirmationId;
    return[await window.maestro.confirmAction({bridgeVersion:1,callId:crypto.randomUUID(),selectionEpoch:data.epoch,confirmationId}),await window.maestro.confirmAction({bridgeVersion:1,callId:crypto.randomUUID(),selectionEpoch:epoch,confirmationId})];},prepared);
   expect(replies.every(r=>r.error!==null)).toBe(true);expect((await f.cli(['project','show',added.data.projectId])).result.data.project.displayName).toBe('Originale');expect((await g.cli(['daemon','status'])).result.liveness).toBe('ABSENT_VERIFIED');
  }finally{await app.close();}
 }finally{await f.cleanup();await g.cleanup();}
});
