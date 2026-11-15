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
