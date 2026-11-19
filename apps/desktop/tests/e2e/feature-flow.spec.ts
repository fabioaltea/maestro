import {test,expect} from '@playwright/test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {createScratch} from '../fixtures/desktop.ts';
import {seedWaitingDiscovery} from '../fixtures/discovery-session.ts';
import {launchDesktop,chooseDirectory} from '../fixtures/electron.ts';
async function openApprovedProject(app:Awaited<ReturnType<typeof launchDesktop>>['app'],page:Awaited<ReturnType<typeof launchDesktop>>['page'],archive:string){
 await chooseDirectory(app,archive);await page.getByRole('button',{name:'Apri archivio',exact:true}).click();await page.locator('.project-row').first().click();await page.getByRole('button',{name:'Discovery',exact:true}).click();const review=page.locator('.discovery-review');await expect(review.getByRole('checkbox')).toHaveCount(3);for(const b of await review.getByRole('checkbox').all())await b.check();await page.getByRole('button',{name:'Approva questa revisione',exact:true}).click();await page.getByRole('button',{name:'Conferma operazione',exact:true}).click();await expect(review).toContainText('Approvazione storica:',{timeout:15000});await page.getByRole('button',{name:'Discovery',exact:true}).click();
}
test('US1 and US2 author, approve and hand off a specific revision with offline history',async()=>{
 test.setTimeout(100000);
 const f=await createScratch();try{
 const seed=await seedWaitingDiscovery(f,true),before=await f.snapshot(seed.repo.path),{app,page}=await launchDesktop(f);
 try{
 await openApprovedProject(app,page,f.archive);
 await page.getByRole('button',{name:'Feature',exact:true}).click();const panel=page.locator('.feature-planning'),editor=panel.getByLabel('Specifica e piano JSON');await expect(editor).toBeVisible();const bundle=JSON.parse(await editor.inputValue());bundle.title='Feature sintetica';bundle.request='<script>richiesta inerte</script>';bundle.unknowns=[{unknownId:'U1',text:'Formato da confermare',impact:'NON_BLOCKING',decision:'OPEN'}];await editor.fill(JSON.stringify(bundle));
 const prepare=panel.getByRole('button',{name:'Prepara creazione',exact:true});await prepare.click();await expect(page.getByRole('dialog')).toContainText('Crea feature');await page.keyboard.press('Escape');await expect(prepare).toBeFocused();await prepare.click();await page.getByRole('button',{name:'Conferma operazione',exact:true}).click();await expect(panel.getByRole('button',{name:'Feature sintetica',exact:true})).toBeVisible({timeout:15000});
 await panel.getByRole('button',{name:'Feature sintetica',exact:true}).click();await expect(editor).toHaveValue(/richiesta inerte/);expect(await panel.locator('script').count()).toBe(0);bundle.request='Seconda revisione';await editor.fill(JSON.stringify(bundle));await panel.getByRole('button',{name:'Prepara nuova revisione',exact:true}).click();await page.getByRole('button',{name:'Conferma operazione',exact:true}).click();await expect(panel.getByRole('button',{name:'Feature sintetica',exact:true})).toBeVisible();await panel.getByRole('button',{name:'Feature sintetica',exact:true}).click();await expect(panel.getByRole('button',{name:'Revisione 2',exact:true})).toBeVisible({timeout:15000});await panel.getByRole('button',{name:'Revisione 1',exact:true}).click();await expect(editor).toHaveValue(/richiesta inerte/);
 await expect(panel).toContainText('Generazione assistita indisponibile');
 await expect(panel.getByRole('button',{name:'Prepara bozza assistita',exact:true})).toBeDisabled();
 const approve=panel.getByRole('button',{name:'Prepara approvazione',exact:true});
 await expect(approve).toBeDisabled();
 await panel.getByRole('button',{name:'Revisione 2',exact:true}).click();
 await expect(editor).toHaveValue(/Seconda revisione/);
 await expect(approve).toBeDisabled();
 await panel.getByRole('checkbox',{name:'Accetto: Formato da confermare'}).check();
 await approve.click();
 const confirmation=page.getByRole('dialog');
 await expect(confirmation).toContainText('Approva specifica e piano');
 await expect(confirmation).toContainText('Incognite accettate: U1');
 await page.keyboard.press('Escape');await expect(approve).toBeFocused();
 await approve.click();await page.getByRole('button',{name:'Conferma operazione',exact:true}).click();
 await expect(panel).toContainText('Approvazione storica:',{timeout:15000});
 await panel.getByRole('button',{name:'Verifica idoneità',exact:true}).click();
 await expect(panel).toContainText('Handoff idoneo al momento della verifica.',{timeout:15000});
 await panel.getByRole('button',{name:'Prepara handoff',exact:true}).click();
 await expect(confirmation).toContainText('Genera handoff per l’implementazione');
 await page.getByRole('button',{name:'Conferma operazione',exact:true}).click();
 await expect(panel.getByText(/^Handoff [a-f0-9-]{36} · Digest [a-f0-9]{64}$/)).toBeVisible({timeout:15000});
 await panel.getByRole('button',{name:'Archivia feature',exact:true}).click();await page.getByRole('button',{name:'Conferma operazione',exact:true}).click();await expect(panel).toContainText('ARCHIVED',{timeout:15000});await panel.getByRole('button',{name:'Feature sintetica',exact:true}).click();await expect(panel.getByRole('button',{name:'Prepara nuova revisione',exact:true})).toBeDisabled();
 }finally{await app.close();}
 expect(await f.snapshot(seed.repo.path)).toEqual(before);await f.cli(['daemon','stop']);const offline=await launchDesktop(f);try{await chooseDirectory(offline.app,f.archive);await offline.page.getByRole('button',{name:'Apri archivio',exact:true}).click();await offline.page.locator('.project-row').first().click();await offline.page.getByRole('button',{name:'Feature',exact:true}).click();await expect(offline.page.locator('.feature-planning')).toContainText('Ultimo stato noto');await offline.page.getByRole('button',{name:'Feature sintetica',exact:true}).click();await expect(offline.page.locator('.feature-planning')).toContainText('Approvazione storica:');await expect(offline.page.getByRole('button',{name:'Prepara handoff',exact:true})).toBeDisabled();}finally{await offline.app.close();}
 }finally{await f.cleanup();}
});

test('US3 qualified fixture creates a turn, confirms an answer and reads the resulting draft offline',async()=>{
 test.setTimeout(100000);
 const f=await createScratch();
 try{
   const seed=await seedWaitingDiscovery(f,true);
   const before=await f.snapshot(seed.repo.path);
   expect((await f.cli(['daemon','stop'])).result.outcome).toBe('SUCCEEDED');
   const actor=fileURLToPath(new URL('../fixtures/feature-planning-daemon.ts',import.meta.url));
   await promisify(execFile)(process.execPath,[actor,f.archive],{timeout:35000,maxBuffer:16384});
   expect((await f.cli(['feature','provider','get'])).result.data.capabilities).toEqual({readonlyPlanning:true,qualified:true});
   const {app,page}=await launchDesktop(f);
   try{
     await openApprovedProject(app,page,f.archive);
     await page.getByRole('button',{name:'Feature',exact:true}).click();
     const panel=page.locator('.feature-planning'),editor=panel.getByLabel('Specifica e piano JSON');
     const bundle=JSON.parse(await editor.inputValue());bundle.title='Piano assistito fixture';await editor.fill(JSON.stringify(bundle));
     await panel.getByRole('button',{name:'Prepara creazione',exact:true}).click();
     await page.getByRole('button',{name:'Conferma operazione',exact:true}).click();
     await panel.getByRole('button',{name:'Piano assistito fixture',exact:true}).click({timeout:15000});
     const prepare=panel.getByRole('button',{name:'Prepara bozza assistita',exact:true});
     await expect(prepare).toBeEnabled();
     await prepare.click();
     await expect(page.getByRole('dialog')).toContainText('Snapshot Discovery:');
     await page.keyboard.press('Escape');
     await expect(prepare).toBeFocused();
     await prepare.click();await page.getByRole('button',{name:'Conferma operazione',exact:true}).click();
     await expect(panel).toContainText('Turno 1 · WAITING_USER',{timeout:15000});
     await expect(panel.getByRole('radio',{name:'Quale stato mostrare?'})).toBeChecked();
     await panel.getByLabel('Risposta al turno').fill('Stato locale visibile');
     await panel.getByRole('button',{name:'Prepara risposta',exact:true}).click();
     await expect(page.getByRole('dialog')).toContainText('Invia risposta e avvia un nuovo turno');
     await expect(page.getByRole('dialog')).toContainText('Domanda: Q1');
     await page.getByRole('button',{name:'Conferma operazione',exact:true}).click();
     await expect(panel).toContainText('Turno 2 · SUCCEEDED',{timeout:15000});
     await expect(editor).toHaveValue(/Piano del turno: Stato locale visibile/);
     await expect(editor).toHaveValue(/USER_CONFIRMED/);
   }finally{await app.close();}
   expect(await f.snapshot(seed.repo.path)).toEqual(before);
   expect((await f.cli(['daemon','stop'])).result.outcome).toBe('SUCCEEDED');
   const offline=await launchDesktop(f);
   try{
     await chooseDirectory(offline.app,f.archive);
     await offline.page.getByRole('button',{name:'Apri archivio',exact:true}).click();
     await offline.page.locator('.project-row').first().click();
     await offline.page.getByRole('button',{name:'Feature',exact:true}).click();
     await offline.page.getByRole('button',{name:'Piano assistito fixture',exact:true}).click();
     await expect(offline.page.getByLabel('Specifica e piano JSON')).toHaveValue(/Piano del turno: Stato locale visibile/);
     await expect(offline.page.getByRole('button',{name:'Prepara bozza assistita',exact:true})).toBeDisabled();
   }finally{await offline.app.close();}
 }finally{await f.cleanup();}
});
