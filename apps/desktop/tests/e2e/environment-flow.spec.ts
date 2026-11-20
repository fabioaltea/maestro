import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {lstat,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createScratch} from '../fixtures/desktop.ts';
import { switchArchiveForRegression } from '../fixtures/electron.ts';
import {openOwnedWorktree} from '../fixtures/owned-worktree.ts';
import {fixtureLock,fixturePackage,startFixtureRegistry} from '../../../../tests/fixtures/environment-registry.ts';

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
     await switchArchiveForRegression(app,page,other.directory);
     await expect(page.getByRole('button',{name:'Ambiente',exact:true})).toHaveCount(0);
     await expect(env.getByText('MANUAL_VERIFIED',{exact:true})).toHaveCount(0);
   }finally{await app.close();}
 }finally{await Promise.all([fixture.cleanup(),other.cleanup()]);}
});

test('qualified environment install and validation require confirmation and preserve job results offline',async()=>{
 test.setTimeout(100000);
 const fixture=await createScratch(),registry=await startFixtureRegistry();
 try{
   const {app,page,workspaceId,worktree,workspaces}=await openOwnedWorktree(fixture);
   try{
     const commandSpecId=randomUUID();
     await writeFile(join(worktree,'check.mjs'),"process.exit(process.argv[2] === 'literal ; |' ? 0 : 2);");
     await writeFile(join(worktree,'package.json'),JSON.stringify({name:'fixture-pnpm',packageManager:'pnpm@9.4.0',dependencies:{[fixturePackage]:'1.0.0'},
       maestro:{validation:[{id:commandSpecId,entry:'check.mjs',argv:['literal ; |'],timeoutMs:5000}]}}));
     await writeFile(join(worktree,'pnpm-lock.yaml'),fixtureLock(registry));
     await workspaces.getByRole('button',{name:'Apri ambiente'}).click();
     const env=page.getByRole('region',{name:'Ambiente del workspace'});
     const confirm=page.getByRole('button',{name:'Conferma operazione',exact:true});
     const refresh=env.getByRole('button',{name:'Aggiorna ambiente'}),plan=env.getByRole('button',{name:'Prepara piano d’ambiente'});
     const install=env.getByRole('button',{name:'Prepara installazione'});
     await plan.click();await confirm.click();
     await expect.poll(async()=> (await fixture.cli(['environment','show',workspaceId])).result.data.environment?.state,{timeout:15000}).toBe('PLANNED');
     await refresh.click();await install.click();
     await expect(page.getByRole('dialog')).toContainText('Script di installazione disabilitati');
     await page.keyboard.press('Escape');await expect(install).toBeFocused();
     expect((await fixture.cli(['environment','show',workspaceId])).result.data.job).toBeNull();
     await install.click();await confirm.click();
     await expect.poll(async()=>{
       const data=(await fixture.cli(['environment','show',workspaceId])).result.data;
       return data.environment?.safeError??data.environment?.state;
     },{timeout:12000}).toBe('READY');
     await refresh.click();
     const job=env.getByRole('region',{name:'Ultimo job d’ambiente'});
     await expect(job).toContainText('SUCCEEDED');
     const result=job.getByRole('button',{name:'Leggi risultato del job'});
     await result.click();await expect(job.getByLabel('Risultato del job')).toContainText('"outcome":"SUCCEEDED"');
     const validate=env.getByRole('button',{name:'Prepara controllo check.mjs'});
     await validate.click();
     await expect(page.getByRole('dialog')).toContainText('Offline, worktree in sola lettura');
     await expect(page.getByRole('dialog')).toContainText('File check.mjs');
     await page.keyboard.press('Escape');await expect(validate).toBeFocused();
     await validate.click();await confirm.click();
     await expect.poll(async()=>{
       const data=(await fixture.cli(['environment','show',workspaceId])).result.data;
       return data.job?.commandSpecId===commandSpecId?(data.job.safeError??data.job.phase):null;
     },{timeout:20000}).toBe('SUCCEEDED');
     await refresh.click();
     await expect(job).toContainText('Uscita verificata');
     await result.click();await expect(job.getByLabel('Risultato del job')).toContainText(commandSpecId);
     expect((await fixture.cli(['daemon','stop'])).result.outcome).toBe('SUCCEEDED');
     await refresh.click();await expect(env).toContainText('Ultimo stato noto');await expect(plan).toBeDisabled();await expect(validate).toBeDisabled();
     await result.click();await expect(job.getByLabel('Risultato del job')).toContainText(commandSpecId);
   }finally{await app.close();}
 }finally{await Promise.all([fixture.cleanup(),registry.close()]);}
});
