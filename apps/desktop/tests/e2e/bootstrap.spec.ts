import { test, expect } from '@playwright/test';
import { createScratch } from '../fixtures/desktop.ts';
import { launchDesktop } from '../fixtures/electron.ts';
test('isolated React desktop starts without starting a daemon', async () => {
  const f = await createScratch();
  try {
    const { app, page } = await launchDesktop(f);
    try {
      await expect(page.getByRole('heading', { name: 'Maestro', exact: true })).toBeVisible();
      const result = await page.evaluate(async () => window.maestro.context({ bridgeVersion: 1, callId: crypto.randomUUID(), selectionEpoch: 0 }));
      expect(result.error).toBeNull();
      expect((result.result as { runtimeReady: boolean }).runtimeReady).toBe(true);
      expect((await f.cli(['daemon', 'status'])).result.liveness).toBe('ABSENT_VERIFIED');
      const metrics = await app.evaluate(({ app }) => app.getAppMetrics().filter(m => m.type === 'Tab').map(m => m.sandboxed));
      expect(metrics.length).toBeGreaterThan(0); expect(metrics.every(Boolean)).toBe(true);
      expect(await page.evaluate(() => Object.isFrozen(window.maestro))).toBe(true);
    } finally { await app.close(); }
  } finally { await f.cleanup(); }
});
