import {test,expect} from '@playwright/test';
import {createScratch} from '../fixtures/desktop.ts';
import {chooseDirectory,launchDesktop} from '../fixtures/electron.ts';

test('agent profiles create revisioned catalogue entries with confirmed receipts and offline history',async()=>{
 const f=await createScratch(),other=await createScratch();
 try{
   expect((await f.cli(['daemon','start'])).result.outcome).toBe('SUCCEEDED');
   const {app,page}=await launchDesktop(f);
   try{
     await chooseDirectory(app,f.archive);await page.getByRole('button',{name:'Apri archivio',exact:true}).click();
     await page.getByRole('button',{name:'Profili agente',exact:true}).click();
     const panel=page.getByRole('region',{name:'Catalogo profili agente'});
     await expect(panel.getByRole('button',{name:'project-architect',exact:true})).toBeVisible();
     await panel.getByRole('button',{name:'Nuovo profilo'}).click();
     await panel.getByLabel('Alias',{exact:true}).fill('fixture-review');
     await panel.getByLabel('Nome',{exact:true}).fill('Revisione fixture');
     await panel.getByLabel('Ruolo',{exact:true}).fill('Reviewer');
     await panel.getByLabel('Istruzioni',{exact:true}).fill('Testo senza autorità implicita.');
     const prepare=panel.getByRole('button',{name:'Prepara salvataggio'});
     await prepare.click();await expect(page.getByRole('dialog')).toContainText('fixture-review');
     await page.keyboard.press('Escape');await expect(prepare).toBeFocused();
     await prepare.click();await page.getByRole('button',{name:'Conferma operazione',exact:true}).click();
     await expect(panel.getByRole('heading',{name:'Revisione fixture'})).toBeVisible();
     await expect(panel.getByText(/Operazione [a-f0-9-]{36}/)).toContainText('TERMINAL');
     expect((await f.cli(['daemon','stop'])).result.outcome).toBe('SUCCEEDED');
     await page.getByRole('button',{name:'Servizio',exact:true}).click();
     await page.getByRole('button',{name:'Profili agente',exact:true}).click();
     await expect(panel.getByText(/Ultimo stato noto/)).toBeVisible();
     await expect(panel.getByRole('button',{name:'fixture-review',exact:true})).toBeVisible();
     await expect(panel.getByRole('button',{name:'Nuovo profilo'})).toBeDisabled();
     await chooseDirectory(app,other.directory);await page.getByRole('button',{name:'Apri archivio',exact:true}).click();
     await expect(panel.getByRole('button',{name:'fixture-review',exact:true})).toHaveCount(0);
   }finally{await app.close();}
 }finally{await Promise.all([f.cleanup(),other.cleanup()]);}
});
