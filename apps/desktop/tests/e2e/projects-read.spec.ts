import { test, expect } from '@playwright/test';
import { createScratch } from '../fixtures/desktop.ts';
import { launchDesktop, chooseDirectory } from '../fixtures/electron.ts';
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
      await chooseDirectory(app, f.archive);
      const choose = page.getByRole('button', { name: 'Apri archivio', exact: true });
      await choose.focus(); await page.keyboard.press('Enter');
      await expect(page.getByText('Servizio attivo', { exact: true })).toBeVisible();
      const seen = new Set<string>();
      for (let i = 0; i < 4; i++) {
        await expect(page.locator('.project-row')).toHaveCount(25);
        const names = await page.locator('.project-row strong').allTextContents();
        for (const name of names) { expect(seen.has(name)).toBe(false); seen.add(name); }
        await page.locator('.project-row').first().click();
        await expect(page.getByRole('article')).toBeVisible();
        await expect(page.getByText('Ultima verifica del repository', { exact: true })).toBeVisible();
        await expect(page.getByText('Ultimo stato noto', { exact: false }).last()).toBeVisible();
        if (i < 3) { const previousFirst = names[0]; await page.getByRole('button', { name: 'Successiva', exact: true }).click(); await expect(page.locator('.project-row strong').first()).not.toHaveText(previousFirst!); }
      }
      expect(seen.size).toBe(100);
      await page.getByRole('button', { name: 'Precedente', exact: true }).click();
      await expect(page.getByText('Pagina 3', { exact: true })).toBeVisible();
      expect((await f.cli(['daemon', 'stop'])).result.outcome).toBe('SUCCEEDED');
      const snapshot = await f.snapshot(f.archive);
      await page.getByRole('button', { name: 'Aggiorna registro', exact: true }).click();
      await expect(page.getByText('Servizio fermo', { exact: true })).toBeVisible();
      await expect(page.getByText('Ultimo stato noto · dati salvati localmente', { exact: true })).toBeVisible();
      await page.locator('.project-row').first().click(); await expect(page.getByRole('article')).toBeVisible();
      expect(await f.snapshot(f.archive)).toEqual(snapshot);
    } finally { await app.close(); }
  } finally { await f.cleanup(); }
});
test('choosing an absent archive does not initialize or start it', async () => {
  const f = await createScratch();
  try {
    const { app, page } = await launchDesktop(f);
    try {
      await chooseDirectory(app, f.archive); await page.getByRole('button', { name: 'Apri archivio', exact: true }).click();
      await expect(page.getByText('Servizio fermo', { exact: true })).toBeVisible();
      expect((await f.cli(['daemon', 'status'])).result.liveness).toBe('ABSENT_VERIFIED');
      const { access } = await import('node:fs/promises'); await expect(access(f.archive)).rejects.toThrow();
    } finally { await app.close(); }
  } finally { await f.cleanup(); }
});
