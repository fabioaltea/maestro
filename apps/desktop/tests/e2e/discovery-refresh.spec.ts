import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createScratch } from '../fixtures/desktop.ts';
import { seedWaitingDiscovery } from '../fixtures/discovery-session.ts';
import { launchDesktop, chooseDirectory } from '../fixtures/electron.ts';
test('G4 desktop shows stale knowledge, preserves approval and requires a fresh explicit preview', async () => {
  const f = await createScratch();
  try {
    const seed = await seedWaitingDiscovery(f, true), { app, page } = await launchDesktop(f);
    try {
      await chooseDirectory(app, f.archive); await page.getByRole('button', { name: 'Apri archivio', exact: true }).click(); await page.locator('.project-row').first().click(); await page.getByRole('button', { name: 'Discovery', exact: true }).click();
      const review = page.locator('.discovery-review'); await expect(review.getByRole('checkbox')).toHaveCount(3); for (const box of await review.getByRole('checkbox').all()) await box.check();
      await page.getByRole('button', { name: 'Approva questa revisione', exact: true }).click(); await page.getByRole('button', { name: 'Conferma operazione', exact: true }).click(); await expect(review).toContainText('Approvazione storica:', { timeout: 15000 });
      const old = (await f.cli(['discovery', 'show', seed.discoveryId])).result.data.discovery.latestDocumentRevisionId;
      await writeFile(join(seed.repo.path, 'file.txt'), 'intentional user change\n'); const changed = await f.snapshot(seed.repo.path);
      await page.getByRole('button', { name: 'Verifica idoneità attuale', exact: true }).click(); await expect(review).toContainText('Idoneità non confermata'); await expect(review).toContainText('Da aggiornare:');
      expect((await f.cli(['discovery', 'document', old, '--metadata'])).result.data.approval.revisionId).toBe(old);
      await page.getByRole('button', { name: 'Nuova Discovery', exact: true }).click(); await expect(page.getByLabel('Percorsi da analizzare', { exact: true })).toBeFocused();
      await page.getByLabel('Percorsi da analizzare', { exact: true }).fill('file.txt'); await page.getByRole('button', { name: 'Prepara anteprima', exact: true }).click(); await page.getByRole('button', { name: 'Conferma operazione', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Anteprima dei contenuti', exact: true })).toBeVisible({ timeout: 15000 });
      expect((await f.cli(['discovery', 'list', seed.projectId])).result.data.items.length).toBe(1); expect(await f.snapshot(seed.repo.path)).toEqual(changed);
    } finally { await app.close(); }
  } finally { await f.cleanup(); }
});
