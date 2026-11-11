import { test, expect } from '@playwright/test';
import { createScratch } from '../fixtures/desktop.ts';
import { launchDesktop } from '../fixtures/electron.ts';
test('renderer has only named methods and cannot execute or navigate arbitrary content', async () => {
  const f = await createScratch();
  try {
    const { app, page } = await launchDesktop(f);
    try {
      expect(await page.evaluate(() => ({ node: typeof (globalThis as unknown as {require?: unknown}).require, process: typeof (globalThis as unknown as {process?: unknown}).process, generic: 'invoke' in window.maestro }))).toEqual({ node: 'undefined', process: 'undefined', generic: false });
      const result = await page.evaluate(() => window.maestro.status({ bridgeVersion: 1, callId: crypto.randomUUID(), selectionEpoch: 0, command: 'whoami' }));
      expect(result.error?.code).toBe('INVALID_INPUT');
      expect(await page.evaluate(async () => { try { await fetch('https://example.com'); return 'allowed'; } catch { return 'blocked'; } })).toBe('blocked');
      expect(await page.evaluate(() => window.open('https://example.com'))).toBeNull();
      const file = await app.evaluate(async ({ net }) => (await net.fetch('maestro://app/%2e%2e/package.json')).status);
      expect(file).toBe(404);
      await page.evaluate(() => { location.href = 'https://example.com/'; });
      await expect(page).toHaveURL('maestro://app/index.html');
    } finally { await app.close(); }
  } finally { await f.cleanup(); }
});
