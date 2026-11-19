import {expect} from '@playwright/test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {seedWaitingDiscovery} from './discovery-session.ts';
import {chooseDirectory,launchDesktop} from './electron.ts';
import type {createScratch} from './desktop.ts';

export async function openOwnedWorktree(fixture:Awaited<ReturnType<typeof createScratch>>){
 const seed=await seedWaitingDiscovery(fixture,true,'main');
 expect((await fixture.cli(['daemon','stop'])).result.outcome).toBe('SUCCEEDED');
 const actor=fileURLToPath(new URL('./workspace-daemon.ts',import.meta.url));
 await promisify(execFile)(process.execPath,[actor,fixture.archive],{timeout:35000,maxBuffer:16384});
 const {app,page}=await launchDesktop(fixture);
 try{
   await chooseDirectory(app,fixture.archive);
   await page.getByRole('button',{name:'Apri archivio',exact:true}).click();
   await page.locator('.project-row').first().click();
   await page.getByRole('button',{name:'Discovery',exact:true}).click();
   const review=page.locator('.discovery-review'),confirm=page.getByRole('button',{name:'Conferma operazione',exact:true});
   await expect(review.getByRole('checkbox')).toHaveCount(3);
   for(const checkbox of await review.getByRole('checkbox').all())await checkbox.check();
   await page.getByRole('button',{name:'Approva questa revisione',exact:true}).click();await confirm.click();
   await expect(review).toContainText('Approvazione storica:',{timeout:15000});
   await page.getByRole('button',{name:'Discovery',exact:true}).click();
   await page.getByRole('button',{name:'Feature',exact:true}).click();
   const panel=page.locator('.feature-planning'),editor=panel.getByLabel('Specifica e piano JSON');
   const bundle=JSON.parse(await editor.inputValue());
   bundle.title='Ambiente fixture';await editor.fill(JSON.stringify(bundle));
   await panel.getByRole('button',{name:'Prepara creazione',exact:true}).click();await confirm.click();
   await panel.getByRole('button',{name:bundle.title,exact:true}).click({timeout:15000});
   await panel.getByRole('button',{name:'Prepara approvazione',exact:true}).click();await confirm.click();
   await expect(panel).toContainText('Approvazione storica:',{timeout:15000});
   await panel.getByRole('button',{name:'Prepara handoff',exact:true}).click();await confirm.click();
   await panel.getByRole('button',{name:'Apri workspace dell’handoff'}).click({timeout:15000});
   const workspaces=page.getByRole('region',{name:'Worktree Git'});
   await workspaces.getByRole('button',{name:'Prepara creazione workspace'}).click();await confirm.click();
   await expect.poll(async()=> (await fixture.cli(['workspace','list',seed.projectId])).result.data.items?.[0]?.state,{timeout:20000}).toBe('READY');
   await workspaces.getByRole('button',{name:'Aggiorna elenco'}).click();
   await expect(workspaces.getByText('READY',{exact:true})).toBeVisible();
   const workspace=(await fixture.cli(['workspace','list',seed.projectId])).result.data.items[0];
   const {storeId}=(await fixture.cli(['daemon','status'])).result;
   return{app,page,workspaceId:workspace.workspaceId as string,worktree:join(fixture.directory,'owned-workspaces',storeId,workspace.workspaceId),workspaces};
 }catch(error){await app.close();throw error;}
}
