import { test, expect } from '@playwright/test';
import { createScratch } from '../fixtures/desktop.ts';
import { launchDesktop, chooseDirectory } from '../fixtures/electron.ts';
test('service controls require a visible confirmation and expose original operation outcomes', async () => {
  const f = await createScratch();
  try {
    const { app, page } = await launchDesktop(f);
    try {
      await chooseDirectory(app, f.archive); await page.getByRole('button', { name: 'Scegli archivio', exact: true }).click();
      await page.getByRole('button', { name: 'Servizio', exact: true }).click();
      await page.getByRole('button', { name: 'Avvia servizio', exact: true }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      expect((await f.cli(['daemon', 'status'])).result.liveness).toBe('ABSENT_VERIFIED');
      await page.getByRole('button', { name: 'Annulla', exact: true }).click();
      await expect(page.getByRole('dialog')).not.toBeVisible();
      await page.getByRole('button', { name: 'Avvia servizio', exact: true }).click();
      await page.getByRole('button', { name: 'Conferma operazione', exact: true }).click();
      await expect(page.getByText('Operazione completata', { exact: true })).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole('button', { name: 'Arresta servizio', exact: true })).toBeEnabled();
      await page.getByRole('button', { name: 'Operazioni', exact: true }).click();
      await expect(page.getByText('Avvio servizio', { exact: true })).toBeVisible();
      await expect(page.getByText('Completata', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Rimuovi ricevuta conclusa', exact: true })).toBeVisible();
    } finally { await app.close(); }
    expect((await f.cli(['daemon', 'status'])).result.liveness).toBe('LIVE_VERIFIED');
  } finally { await f.cleanup(); }
});
