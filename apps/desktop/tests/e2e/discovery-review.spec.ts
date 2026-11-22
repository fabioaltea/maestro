import { test, expect } from '@playwright/test';
import { createScratch } from '../fixtures/desktop.ts';
import { seedWaitingDiscovery } from '../fixtures/discovery-session.ts';
import { launchDesktop } from '../fixtures/electron.ts';
test('review loads verified chunks, renders hostile text inert and binds keyboard confirmation to one revision', async () => {
  const f = await createScratch();
  try {
    const seed = await seedWaitingDiscovery(f, true), before = await f.snapshot(seed.repo.path), { app, page } = await launchDesktop(f);
    try {
      await page.locator('.project-row').first().click(); await page.getByRole('button', { name: 'Analizza codebase', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Conoscenza del progetto', exact: true })).toBeVisible();
      const approve = page.getByRole('button', { name: 'Approva questa revisione', exact: true }); await expect(approve).toBeDisabled();
      await expect(page.locator('.discovery-review')).toContainText('<script>Contenuto sintetico'); expect(await page.locator('.discovery-review script').count()).toBe(0);
      for (const box of await page.locator('.discovery-review').getByRole('checkbox').all()) { await box.focus(); await page.keyboard.press('Space'); }
      await expect(approve).toBeEnabled(); await approve.focus(); await page.keyboard.press('Enter'); await expect(page.getByRole('dialog')).toContainText('Digest:'); await page.keyboard.press('Escape'); await expect(approve).toBeFocused();
      await page.getByLabel('Correzione alla revisione', { exact: true }).fill('Chiarisci le ipotesi.'); await page.getByRole('button', { name: 'Invia correzione', exact: true }).click(); await expect(page.getByRole('dialog')).toContainText('nuova revisione'); await page.keyboard.press('Escape');
    } finally { await app.close(); }
    expect(await f.snapshot(seed.repo.path)).toEqual(before);
  } finally { await f.cleanup(); }
});
