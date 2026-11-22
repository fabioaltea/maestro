import { test, expect } from '@playwright/test';
import { createScratch } from '../fixtures/desktop.ts';
import { seedWaitingDiscovery } from '../fixtures/discovery-session.ts';
import { launchDesktop } from '../fixtures/electron.ts';
test('review UNKNOWN controls and exact approval remain keyboard reachable with focus restored after Escape', async () => {
  const f = await createScratch();
  try {
    await seedWaitingDiscovery(f, true); const { app, page } = await launchDesktop(f);
    try {
      await page.locator('.project-row').first().click(); await page.getByRole('button', { name: 'Analizza codebase', exact: true }).click();
      const review = page.locator('.discovery-review'); await expect(review.getByRole('checkbox')).toHaveCount(3);
      const boxes = review.getByRole('checkbox'); await boxes.first().focus();
      for (let i = 0; i < 3; i++) { await expect(boxes.nth(i)).toBeFocused(); await page.keyboard.press('Space'); await expect(boxes.nth(i)).toBeChecked(); if (i < 2) await page.keyboard.press('Tab'); }
      const approve = page.getByRole('button', { name: 'Approva questa revisione', exact: true }); await approve.focus(); await page.keyboard.press('Enter'); await expect(page.getByRole('dialog')).toBeVisible(); await expect(page.getByRole('button', { name: 'Annulla', exact: true })).toBeFocused(); await page.keyboard.press('Tab'); await expect(page.getByRole('button', { name: 'Conferma operazione', exact: true })).toBeFocused(); await page.keyboard.press('Escape'); await expect(approve).toBeFocused();
    } finally { await app.close(); }
  } finally { await f.cleanup(); }
});
