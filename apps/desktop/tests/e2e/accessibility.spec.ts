import { test, expect } from '@playwright/test';
import type { Page, Locator } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createScratch } from '../fixtures/desktop.ts';
import { launchDesktop, chooseDirectory } from '../fixtures/electron.ts';
async function activate(page:Page,target:Locator){await expect(target).toBeEnabled();await target.focus();await expect(target).toBeFocused();await page.keyboard.press('Enter');}
async function activateSetting(page:Page,name:string){
 await activate(page,page.getByRole('navigation',{name:'Sezioni principali'}).getByRole('button',{name:'Impostazioni',exact:true}));
 await activate(page,page.getByRole('navigation',{name:'Sezioni impostazioni'}).getByRole('button',{name,exact:true}));
}
async function type(page:Page,target:Locator,value:string){await target.focus();await page.keyboard.press('Meta+A');await page.keyboard.insertText(value);}
async function contrast(page:Page){return page.evaluate(()=>{
 const rgb=(s:string)=>s.match(/[\d.]+/g)!.slice(0,3).map(Number);const lum=(s:string)=>rgb(s).map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4;}).reduce((a,x,i)=>a+x*[.2126,.7152,.0722][i]!,0);
 const failures:{text:string;ratio:number}[]=[];let checked=0;
 for(const e of document.querySelectorAll<HTMLElement>('body *')){
  if(![...e.childNodes].some(n=>n.nodeType===Node.TEXT_NODE&&n.textContent?.trim())||!e.getClientRects().length||e.closest('[disabled]'))continue;
  const style=getComputedStyle(e);if(style.visibility==='hidden')continue;let bg='',parent:HTMLElement|null=e;
  while(parent){const color=getComputedStyle(parent).backgroundColor;if(!['rgba(0, 0, 0, 0)','transparent'].includes(color)){bg=color;break;}parent=parent.parentElement;}
  if(!bg)bg='rgb(22, 24, 27)';const a=lum(style.color),b=lum(bg),ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);checked++;if(ratio<4.5)failures.push({text:e.textContent!.trim().slice(0,60),ratio});
 }return{checked,failures};
});}
test('primary flows accept keyboard activation, dialog trap/focus return, inert text, labels and contrast at 1280x800',async({},testInfo)=>{
 test.setTimeout(120000);const f=await createScratch(),screens=testInfo.outputPath('screenshots');await mkdir(screens,{recursive:true});
 try{const repo=await f.repository('tastiera');const {app,page}=await launchDesktop(f);try{
  const bounds=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0]!.getBounds());expect([bounds.width,bounds.height]).toEqual([1280,800]);
  const navigation=page.getByRole('navigation',{name:'Sezioni principali'});
  await activate(page,navigation.getByRole('button',{name:'Impostazioni',exact:true}));
  const settings=page.getByRole('navigation',{name:'Sezioni impostazioni'});
  await expect(settings.getByRole('button')).toHaveCount(11);
  await expect(settings.getByRole('button',{name:'Workspace',exact:true})).toBeDisabled();
  await page.screenshot({path:join(screens,'settings.png')});const results=[{view:'settings',...await contrast(page)}];
  await activateSetting(page,'Servizio');
  await activate(page,page.getByRole('navigation',{name:'Percorso impostazioni'}).getByRole('button',{name:'Impostazioni',exact:true}));
  await expect(settings).toBeVisible();
  await activateSetting(page,'Servizio');
  const start=page.getByRole('button',{name:'Avvia servizio',exact:true});await activate(page,start);await expect(page.getByRole('button',{name:'Annulla',exact:true})).toBeFocused();
  await page.keyboard.press('Shift+Tab');await expect(page.getByRole('button',{name:'Conferma operazione',exact:true})).toBeFocused();await page.keyboard.press('Escape');await expect(start).toBeFocused();
  await activate(page,start);await activate(page,page.getByRole('button',{name:'Conferma operazione',exact:true}));await expect(page.getByText('Attivo',{exact:true})).toBeVisible();
  await activate(page,page.getByRole('button',{name:'Repository',exact:true}));
  await chooseDirectory(app,repo.path);await activate(page,page.getByRole('button',{name:'Apri repository',exact:true}));
  await expect(page.getByRole('heading',{name:'tastiera',exact:true})).toBeVisible();
  await activate(page,page.getByRole('button',{name:'Verifica repository',exact:true}));await expect(page.getByText('Osservazione salvata. Disponibilità ed eventuali errori sono riportati sopra.',{exact:true})).toBeVisible();
  await activate(page,page.getByRole('button',{name:'Modifica progetto',exact:true}));await type(page,page.getByLabel('Nome progetto',{exact:true}),'<img src=x onerror=alert(1)>');await activate(page,page.getByRole('button',{name:'Rivedi modifica',exact:true}));await activate(page,page.getByRole('button',{name:'Conferma operazione',exact:true}));await expect(page.getByRole('heading',{name:'<img src=x onerror=alert(1)>',exact:true})).toBeVisible();expect(await page.locator('.detail img').count()).toBe(0);
  await page.screenshot({path:join(screens,'projects.png')});results.push({view:'projects',...await contrast(page)});
  await activate(page,page.getByRole('button',{name:'Rimuovi dal registro',exact:true}));await expect(page.getByRole('dialog')).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'Rimuovi dal registro',exact:true})).toBeFocused();await activate(page,page.getByRole('button',{name:'Rimuovi dal registro',exact:true}));await activate(page,page.getByRole('button',{name:'Conferma operazione',exact:true}));await expect(page.getByText('Nessun repository recente.',{exact:true})).toBeVisible();
  await activateSetting(page,'Attività');await expect(page.locator('.event-row').first()).toBeVisible();await activate(page,page.getByRole('button',{name:'Segui attività',exact:true}));await activate(page,page.getByRole('button',{name:'Interrompi osservazione',exact:true}));await activate(page,page.getByRole('button',{name:'Riconnetti',exact:true}));await expect(page.getByText('Osservazione live',{exact:true})).toBeVisible();await page.screenshot({path:join(screens,'activity.png')});results.push({view:'activity',...await contrast(page)});
  await activateSetting(page,'Diagnostica');await expect(page.locator('.diagnostics-data')).toBeVisible();results.push({view:'diagnostics',...await contrast(page)});
  await activateSetting(page,'Servizio');await activate(page,page.getByRole('button',{name:'Riavvia servizio',exact:true}));await activate(page,page.getByRole('button',{name:'Conferma operazione',exact:true}));await expect(page.getByText('Attivo',{exact:true})).toBeVisible();await activate(page,page.getByRole('button',{name:'Arresta servizio',exact:true}));await activate(page,page.getByRole('button',{name:'Conferma operazione',exact:true}));await expect(page.getByText('Fermo',{exact:true})).toBeVisible();results.push({view:'service',...await contrast(page)});
  await activateSetting(page,'Operazioni');await expect(page.locator('.receipt-row').first()).toBeVisible();await activate(page,page.getByRole('button',{name:'Rimuovi ricevuta conclusa',exact:true}).first());results.push({view:'operations',...await contrast(page)});
  for(const r of results){expect(r.checked).toBeGreaterThan(0);expect(r.failures).toEqual([]);}await writeFile(join(screens,'accessibility.json'),JSON.stringify({measuredAt:new Date().toISOString(),viewport:[1280,800],results,manualNativePicker:'NOT_RUN; automated tests stub only dialog results'},null,2)+'\n');
 }finally{await app.close();}}finally{await f.cleanup();}
});
