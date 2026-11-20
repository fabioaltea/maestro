import { test, expect } from '@playwright/test';
import { createScratch } from '../fixtures/desktop.ts';
import { launchDesktop } from '../fixtures/electron.ts';

test('opening Discovery with no provider preserves the repository and does not invent an available AI session', async () => {
  const f = await createScratch();
  try {
    await f.cli(['daemon', 'start']); const repo = await f.repository(), before = await f.snapshot(repo.path);
    const projectId = (await f.cli(['project', 'add', repo.path, '--name=Discovery UI'])).result.data.projectId;
    const { app, page } = await launchDesktop(f);
    try {
      await page.locator('.project-row').first().click(); await page.getByRole('button', { name: 'Analizza codebase', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Discovery del progetto', exact: true })).toBeVisible();
      await expect(page.getByText('Provider non configurato', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Avvia Discovery', exact: true })).toBeDisabled();
      expect((await f.cli(['discovery', 'list', projectId])).result.data.items).toHaveLength(0);
      expect(await f.snapshot(repo.path)).toEqual(before);
    } finally { await app.close(); }
  } finally { await f.cleanup(); }
});
test('local preview requires an explicit action, cancellation is inert and the data-sending gate remains closed', async () => {
  const f = await createScratch();
  try {
    await f.cli(['daemon', 'start']); const repo = await f.repository(), before = await f.snapshot(repo.path);
    const projectId = (await f.cli(['project', 'add', repo.path, '--name=Anteprima UI'])).result.data.projectId;
    const { app, page } = await launchDesktop(f);
    try {
      await page.locator('.project-row').first().click(); await page.getByRole('button', { name: 'Analizza codebase', exact: true }).click();
      await page.getByLabel('Percorsi da analizzare', { exact: true }).fill('../fuori-progetto');
      await page.getByRole('button', { name: 'Prepara anteprima', exact: true }).click();
      await expect(page.locator('#discovery-error')).toContainText('percorsi relativi');
      await page.getByLabel('Percorsi da analizzare', { exact: true }).fill('file.txt');
      await page.getByRole('button', { name: 'Prepara anteprima', exact: true }).click();
      await expect(page.getByRole('dialog')).toBeVisible(); await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).not.toBeVisible();
      await expect(page.getByRole('button', { name: 'Prepara anteprima', exact: true })).toBeFocused();
      await page.getByRole('button', { name: 'Prepara anteprima', exact: true }).click();
      await page.getByRole('button', { name: 'Conferma operazione', exact: true }).click();
      await expect(page.getByText('file.txt', { exact: true })).toBeVisible({ timeout: 15000 });
      await expect(page.getByRole('button', { name: 'Avvia Discovery', exact: true })).toBeDisabled();
      expect((await f.cli(['discovery', 'list', projectId])).result.data.items).toHaveLength(0); expect(await f.snapshot(repo.path)).toEqual(before);
    } finally { await app.close(); }
  } finally { await f.cleanup(); }
});
