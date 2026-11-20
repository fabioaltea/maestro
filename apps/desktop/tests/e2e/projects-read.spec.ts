import { test, expect } from '@playwright/test';
import { createScratch } from '../fixtures/desktop.ts';
import { launchDesktop } from '../fixtures/electron.ts';
test('one hundred real projects remain reachable live and offline without archive writes', async () => {
  test.setTimeout(240_000);
  const f = await createScratch();
  try {
    expect((await f.cli(['daemon', 'start'])).result.outcome).toBe('SUCCEEDED');
    for (let start = 0; start < 100; start += 4) await Promise.all(Array.from({ length: 4 }, async (_, offset) => {
      const name = `Progetto ${String(start + offset).padStart(3, '0')}`;
      const repository = await f.repository(name, false);
      const result = (await f.cli(['project', 'add', repository.path, `--name=${name}`])).result;
      expect(result.outcome).toBe('SUCCEEDED');
    }));
    const { app, page } = await launchDesktop(f);
    try {
      for (let i = 1; i <= 4; i++) {
        await expect(page.locator('.project-row')).toHaveCount(i * 25);
        if (i < 4) await page.getByRole('button', { name: 'Altri repository', exact: true }).click();
      }
      const names = await page.locator('.project-row strong').allTextContents();
      expect(new Set(names).size).toBe(100);
      await page.locator('.project-row').first().click();
      await expect(page.getByRole('article')).toBeVisible();
      expect((await f.cli(['daemon', 'stop'])).result.outcome).toBe('SUCCEEDED');
      const snapshot = await f.snapshot(f.archive);
      await page.getByRole('button', { name: 'Aggiorna repository', exact: true }).click();
      await expect(page.getByText('Ultimo stato noto · servizio fermo', { exact: true })).toBeVisible();
      await page.locator('.project-row').first().click(); await expect(page.getByRole('article')).toBeVisible();
      expect(await f.snapshot(f.archive)).toEqual(snapshot);
    } finally { await app.close(); }
  } finally { await f.cleanup(); }
});
test('launching with an absent private archive does not initialize or start it', async () => {
  const f = await createScratch();
  try {
    const { app, page } = await launchDesktop(f);
    try {
      await expect(page.getByRole('button', { name: 'Apri repository', exact: true })).toBeEnabled();
      expect((await f.cli(['daemon', 'status'])).result.liveness).toBe('ABSENT_VERIFIED');
      const { access } = await import('node:fs/promises'); await expect(access(f.archive)).rejects.toThrow();
    } finally { await app.close(); }
  } finally { await f.cleanup(); }
});
