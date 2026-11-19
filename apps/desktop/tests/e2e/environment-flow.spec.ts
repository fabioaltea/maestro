import {test,expect} from '@playwright/test';
import {lstat,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createScratch} from '../fixtures/desktop.ts';
import {chooseDirectory} from '../fixtures/electron.ts';
import {openOwnedWorktree} from '../fixtures/owned-worktree.ts';

test('environment plan and manual attestation use the original receipt across offline and archive change',async()=>{
 test.setTimeout(100000);
 const fixture=await createScratch(),other=await createScratch();
 try{
   const {app,page,workspaceId,worktree,workspaces}=await openOwnedWorktree(fixture);
   try{
     await writeFile(join(worktree,'package.json'),JSON.stringify({name:'fixture-npm',packageManager:'npm@11.20.0'}));
     await writeFile(join(worktree,'package-lock.json'),'{"lockfileVersion":3}\n');
     await workspaces.getByRole('button',{name:'Apri ambiente'}).click();
     const env=page.getByRole('region',{name:'Ambiente del workspace'});
     const plan=env.getByRole('button',{name:'Prepara piano d’ambiente'}),confirm=page.getByRole('button',{name:'Conferma operazione',exact:true});
     await plan.click();await expect(page.getByRole('dialog')).toContainText(workspaceId);
     await page.keyboard.press('Escape');await expect(plan).toBeFocused();
     await plan.click();await confirm.click();
     await expect.poll(async()=> (await fixture.cli(['environment','show',workspaceId])).result.data.environment?.state,{timeout:15000}).toBe('MANUAL_REQUIRED');
     await env.getByRole('button',{name:'Aggiorna ambiente'}).click();
     await expect(env).toContainText('MANAGER_UNSUPPORTED');
     await expect(env.getByText(/Operazione [a-f0-9-]{36}/)).toBeVisible();
     await env.getByLabel('Limitazioni verificate').fill('Dipendenze controllate manualmente');
     await env.getByRole('button',{name:'Prepara attestazione manuale'}).click();
     await expect(page.getByRole('dialog')).toContainText('Dipendenze controllate manualmente');
     await confirm.click();
     await expect(env).toContainText('MANUAL_VERIFIED',{timeout:15000});
     await expect(lstat(join(worktree,'node_modules'))).rejects.toThrow();
     expect((await fixture.cli(['daemon','stop'])).result.outcome).toBe('SUCCEEDED');
     await env.getByRole('button',{name:'Aggiorna ambiente'}).click();
     await expect(env).toContainText('Ultimo stato noto');
     await expect(env).toContainText('MANUAL_VERIFIED');await expect(plan).toBeDisabled();
     await chooseDirectory(app,other.directory);
     await page.getByRole('button',{name:'Apri archivio',exact:true}).click();
     await expect(env).toContainText('Scegli un worktree');
     await expect(env.getByText('MANUAL_VERIFIED',{exact:true})).toHaveCount(0);
   }finally{await app.close();}
 }finally{await Promise.all([fixture.cleanup(),other.cleanup()]);}
});
