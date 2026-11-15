import { test, expect } from '@playwright/test';
import { createScratch } from '../fixtures/desktop.ts';
import { launchDesktop, chooseDirectory } from '../fixtures/electron.ts';
test('repository picker and explicit import display the actual registered project without changing files', async () => {
  const f = await createScratch();
  try {
    await f.cli(['daemon', 'start']); const repo = await f.repository('repo con spazi'); const before = await f.snapshot(repo.path);
    const { app, page } = await launchDesktop(f);
    try {
      await chooseDirectory(app, f.archive); await page.getByRole('button', { name: 'Scegli archivio', exact: true }).click();
      await page.getByRole('button', { name: 'Importa progetto', exact: true }).click();
      await chooseDirectory(app, repo.path); await page.getByRole('button', { name: 'Scegli repository', exact: true }).click();
      await page.getByLabel('Nome progetto (facoltativo)', { exact: true }).fill('Progetto UI');
      await page.getByLabel('Branch base locale (facoltativo)', { exact: true }).fill('main');
      await page.getByRole('button', { name: 'Rivedi importazione', exact: true }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      expect((await f.cli(['project', 'list'])).result.data.projects).toHaveLength(0);
      await page.getByRole('button', { name: 'Conferma operazione', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Progetto UI', exact: true })).toBeVisible({ timeout: 15_000 });
      const list = (await f.cli(['project', 'list'])).result.data.projects;
      expect(list).toHaveLength(1); expect(list[0].displayName).toBe('Progetto UI'); expect(list[0].baseBranch).toBe('main');
      expect(await f.snapshot(repo.path)).toEqual(before);
      const { writeFile, rename } = await import('node:fs/promises'); const { join } = await import('node:path');
      await writeFile(join(repo.path, 'untracked.txt'), 'local work'); const changed = await f.snapshot(repo.path);
      await page.getByRole('button', { name: 'Verifica repository', exact: true }).click();
      await expect(page.getByText('Non tracciati: Sì', { exact: true })).toBeVisible();
      await expect(page.getByText('Osservazione salvata. Disponibilità ed eventuali errori sono riportati sopra.', { exact: true })).toBeVisible();
      expect(await f.snapshot(repo.path)).toEqual(changed);
      await rename(repo.path, `${repo.path}-moved`);
      await page.getByRole('button', { name: 'Verifica repository', exact: true }).click();
      await expect(page.getByText('Non disponibile all’ultima verifica', { exact: true })).toBeVisible();
      await expect(page.getByText('Modifiche: Non verificato', { exact: true })).toBeVisible();
      expect(await f.snapshot(`${repo.path}-moved`)).toEqual(changed);
    } finally { await app.close(); }
  } finally { await f.cleanup(); }
});
test('stale configuration approval is rejected and a new explicit review can clear the base atomically', async () => {
  const f = await createScratch();
  try {
    await f.cli(['daemon', 'start']); const repo = await f.repository();
    const added = (await f.cli(['project', 'add', repo.path, '--name=Iniziale', '--base-branch=main'])).result;
    const projectId = added.data.projectId as string, before = await f.snapshot(repo.path);
    const { app, page } = await launchDesktop(f);
    try {
      await chooseDirectory(app, f.archive); await page.getByRole('button', { name: 'Scegli archivio', exact: true }).click();
      await page.locator('.project-row').first().click(); await page.getByRole('button', { name: 'Modifica progetto', exact: true }).click();
      await page.getByLabel('Nome progetto', { exact: true }).fill('Proposta');
      await page.getByLabel('Configurazione branch base', { exact: true }).selectOption('clear');
      await page.getByRole('button', { name: 'Rivedi modifica', exact: true }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await f.cli(['project', 'update', projectId, '--expected-revision=1', '--name=Concorrenza']);
      await page.getByRole('button', { name: 'Conferma operazione', exact: true }).click();
      await expect(page.getByText('Revisione configurazione non più corrente.', { exact: true })).toBeVisible();
      expect((await f.cli(['project', 'show', projectId])).result.data.project.displayName).toBe('Concorrenza');
      await expect(page.getByLabel('Nome progetto', { exact: true })).toHaveValue('Proposta');
      await page.getByRole('button', { name: 'Ricarica configurazione', exact: true }).click();
      await expect(page.getByLabel('Nome progetto', { exact: true })).toHaveValue('Concorrenza');
      await page.getByLabel('Nome progetto', { exact: true }).fill('Proposta');
      await page.getByLabel('Configurazione branch base', { exact: true }).selectOption('clear');
      await page.getByRole('button', { name: 'Rivedi modifica', exact: true }).click();
      await page.getByRole('button', { name: 'Conferma operazione', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Proposta', exact: true })).toBeVisible();
      const final = (await f.cli(['project', 'show', projectId])).result.data.project;
      expect(final.configRevision).toBe('3'); expect(final.baseBranch).toBeNull(); expect(await f.snapshot(repo.path)).toEqual(before);
    } finally { await app.close(); }
  } finally { await f.cleanup(); }
});
