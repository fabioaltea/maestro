import { test, expect } from '@playwright/test';
import { createScratch } from '../fixtures/desktop.ts';
import { seedWaitingDiscovery } from '../fixtures/discovery-session.ts';
import { launchDesktop } from '../fixtures/electron.ts';
test('a durable interview reopens, renders inert output and confirms UNKNOWN without duplicating a run', async () => {
  const f = await createScratch();
  try {
    const seed = await seedWaitingDiscovery(f), before = await f.snapshot(seed.repo.path);
    for (const reopen of [false, true]) {
      const { app, page } = await launchDesktop(f);
      try {
        await page.locator('.project-row').first().click(); await page.getByRole('button', { name: 'Analizza codebase', exact: true }).click();
        await expect(page.getByRole('heading', { name: 'Quale distribuzione è prevista?', exact: true })).toBeVisible();
        await expect(page.getByLabel('Output Discovery', { exact: true })).toContainText('<img src=x onerror=alert(1)>'); expect(await page.locator('img[src=x]').count()).toBe(0);
        if (!reopen) { await page.getByRole('button', { name: 'Invia e continua', exact: true }).click(); await expect(page.getByRole('alert').filter({ hasText: 'Scrivi una risposta' })).toBeVisible(); }
        const unknown = page.getByRole('button', { name: 'Non so', exact: true }); await unknown.focus(); await page.keyboard.press('Enter');
        await expect(page.getByRole('dialog')).toBeVisible();
        if (!reopen) { await page.keyboard.press('Escape'); await expect(unknown).toBeFocused(); }
        else {
          await page.getByRole('button', { name: 'Conferma operazione', exact: true }).click();
          await expect(page.getByText('UNKNOWN confermato', { exact: true })).toBeVisible({ timeout: 15000 });
          const question = (await f.cli(['discovery', 'questions', seed.discoveryId])).result.data.items[0]; expect(question.answer.kind).toBe('UNKNOWN');
          expect((await f.cli(['discovery', 'show', seed.discoveryId])).result.data.discovery.currentRunId).toBe(seed.runId);
          await page.getByRole('button', { name: 'Annulla Discovery', exact: true }).click(); await expect(page.getByRole('dialog')).toBeVisible(); await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).not.toBeVisible();
          expect((await f.cli(['discovery', 'show', seed.discoveryId])).result.data.discovery.state).toBe('WAITING_USER');
          await page.getByRole('button', { name: 'Annulla Discovery', exact: true }).click(); await page.getByRole('button', { name: 'Conferma operazione', exact: true }).click();
          await expect(page.getByRole('status').filter({ hasText: /^Annullata$/ })).toBeVisible({ timeout: 10000 });
          expect((await f.cli(['discovery', 'questions', seed.discoveryId])).result.data.items[0].answer.kind).toBe('UNKNOWN');
        }
      } finally { await app.close(); }
    }
    expect(await f.snapshot(seed.repo.path)).toEqual(before);
  } finally { await f.cleanup(); }
});
