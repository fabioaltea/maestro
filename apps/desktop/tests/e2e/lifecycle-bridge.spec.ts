import { test, expect } from '@playwright/test';
import { createScratch } from '../fixtures/desktop.ts';
import { launchDesktop, chooseDirectory } from '../fixtures/electron.ts';
test('named bridge requires confirmation, returns no private receipt fields and leaves service running on app close', async () => {
  const f = await createScratch();
  try {
    const { app, page } = await launchDesktop(f);
    try {
      await chooseDirectory(app, f.archive); await page.getByRole('button', { name: 'Apri archivio', exact: true }).click();
      await expect(page.getByText('Servizio fermo', { exact: true })).toBeVisible();
      const prepared = await page.evaluate(async () => {
        const context = await window.maestro.context({ bridgeVersion: 1, callId: crypto.randomUUID(), selectionEpoch: 0 });
        return await window.maestro.prepareAction({ bridgeVersion: 1, callId: crypto.randomUUID(), selectionEpoch: context.selectionEpoch, action: 'daemon.start', params: {} });
      });
      expect(prepared.error).toBeNull(); expect((await f.cli(['daemon', 'status'])).result.liveness).toBe('ABSENT_VERIFIED');
      const confirmationId = (prepared.result as { confirmationId: string }).confirmationId;
      const completed = await page.evaluate(async ({ confirmationId, epoch }) => window.maestro.confirmAction({ bridgeVersion: 1, callId: crypto.randomUUID(), selectionEpoch: epoch, confirmationId }), { confirmationId, epoch: prepared.selectionEpoch });
      expect(completed.error).toBeNull();
      const result = completed.result as { result: { outcome: string }; receipt: Record<string, unknown> };
      expect(result.result.outcome).toBe('SUCCEEDED'); expect(result.receipt).not.toHaveProperty('archivePath'); expect(result.receipt).not.toHaveProperty('intentHash');
    } finally { await app.close(); }
    expect((await f.cli(['daemon', 'status'])).result.liveness).toBe('LIVE_VERIFIED');
  } finally { await f.cleanup(); }
});
