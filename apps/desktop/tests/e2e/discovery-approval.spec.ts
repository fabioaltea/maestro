import { test, expect } from '@playwright/test';
import { createScratch } from '../fixtures/desktop.ts';
import { seedWaitingDiscovery } from '../fixtures/discovery-session.ts';
import { launchDesktop, chooseDirectory } from '../fixtures/electron.ts';
test('G3 desktop explicitly approves a fixture revision and independently checks eligibility; history stays readable offline', async () => {
  const f = await createScratch();
  try {
    const seed = await seedWaitingDiscovery(f, true), before = await f.snapshot(seed.repo.path), { app, page } = await launchDesktop(f);
    let revisionId: string;
    try {
      await chooseDirectory(app, f.archive); await page.getByRole('button', { name: 'Apri archivio', exact: true }).click(); await page.locator('.project-row').first().click(); await page.getByRole('button', { name: 'Discovery', exact: true }).click();
      const review = page.locator('.discovery-review'); await expect(review.getByRole('checkbox')).toHaveCount(3);
      for (const box of await review.getByRole('checkbox').all()) await box.check();
      await page.getByRole('button', { name: 'Approva questa revisione', exact: true }).click(); await expect(page.getByRole('dialog')).toContainText('UNKNOWN accettato:'); await page.getByRole('button', { name: 'Conferma operazione', exact: true }).click();
      await expect(review).toContainText('Approvazione storica:', { timeout: 15000 });
      const d = (await f.cli(['discovery', 'show', seed.discoveryId])).result.data.discovery; expect(d.state).toBe('APPROVED'); revisionId = d.latestDocumentRevisionId;
      await page.getByRole('button', { name: 'Verifica idoneità attuale', exact: true }).click(); await expect(review).toContainText('Idonea nel contesto verificato');
      expect((await f.cli(['discovery', 'document', revisionId!, '--metadata'])).result.data.approval.revisionId).toBe(revisionId!);
    } finally { await app.close(); }
    await f.cli(['daemon', 'stop']); expect((await f.cli(['discovery', 'eligibility', seed.projectId])).result.data.eligible).toBe(false);
    expect((await f.cli(['discovery', 'document', revisionId!, '--metadata'])).result.freshness).toBe('LAST_KNOWN'); expect(await f.snapshot(seed.repo.path)).toEqual(before);
  } finally { await f.cleanup(); }
});
