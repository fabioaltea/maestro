import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createScratch } from '../fixtures/desktop.ts';
import { chooseDirectory, launchDesktop } from '../fixtures/electron.ts';

test('browses main in tabs and finds text without reading the checkout', async () => {
  test.setTimeout(60_000);
  const fixture = await createScratch();
  try {
    const repo = await fixture.repository('Code browser');
    await repo.git(['branch', '-M', 'main']);
    await mkdir(join(repo.path, 'src'));
    const nested = join(repo.path, 'src', 'components', 'a-deliberately-long-folder-name-to-challenge-the-explorer');
    await mkdir(nested, { recursive: true });
    await Promise.all(Array.from({ length: 48 }, (_, index) =>
      writeFile(join(nested, `fixture-${index.toString().padStart(2, '0')}.txt`), 'fixture')));
    const code = join(repo.path, 'src', 'index.ts');
    await writeFile(code, `export const value = "Snapshot main";\n// ${'long line '.repeat(160)}\n`);
    await writeFile(join(repo.path, 'src', 'data.json'), '{"active":true}\n');
    await repo.git(['add', '--', 'src']);
    await repo.git(['commit', '-m', 'Add code']);
    await repo.git(['switch', '-c', 'another-checkout']);
    await writeFile(code, 'dirty checkout\n');
    const { app, page } = await launchDesktop(fixture);
    try {
      await chooseDirectory(app, repo.path);
      await page.getByRole('button', { name: 'Apri repository', exact: true }).click();
      await page.getByRole('button', { name: 'Codice', exact: true }).click();
      const browser = page.getByRole('region', { name: 'Codice' });
      await browser.getByRole('button', { name: 'src', exact: true }).click();
      await browser.getByRole('button', { name: 'index.ts', exact: true }).click();
      await expect(browser.getByText(/Snapshot main/)).toBeVisible();
      await browser.getByRole('searchbox', { name: 'Cerca nel file' }).fill('Snapshot');
      await expect(browser.getByText('1 corrispondenza')).toBeVisible();
      const editor = browser.getByRole('tabpanel');
      const explorer = browser.getByRole('navigation', { name: 'File di main' });
      const frame = browser.locator('.repository-code-layout');
      const source = browser.getByLabel('Contenuto del file', { exact: true });
      for (const width of [1280, 700]) {
        await page.setViewportSize({ width, height: 800 });
        const before = (await editor.boundingBox())!;
        const components = explorer.getByRole('button', { name: 'components', exact: true });
        if (await components.getAttribute('aria-expanded') === 'true') await components.click();
        await components.click();
        const nestedFolder = explorer.getByRole('button', { name: 'a-deliberately-long-folder-name-to-challenge-the-explorer', exact: true });
        if (await nestedFolder.getAttribute('aria-expanded') === 'true') await nestedFolder.click();
        await nestedFolder.click();
        await expect(explorer.getByRole('button', { name: 'fixture-00.txt', exact: true })).toBeVisible();
        expect(await editor.boundingBox()).toEqual(before);
        expect(await explorer.evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
        expect(await source.evaluate(node => node.scrollWidth > node.clientWidth)).toBe(true);
        expect(await frame.evaluate(node => node.scrollWidth === node.clientWidth)).toBe(true);
        await browser.getByRole('button', { name: 'Esplora file' }).click();
        await expect(explorer).toBeHidden();
        expect((await editor.boundingBox())!.width).toBeGreaterThanOrEqual(before.width);
        await expect(browser.getByRole('tab', { name: 'index.ts' })).toHaveAttribute('aria-selected', 'true');
        await browser.getByRole('button', { name: 'Esplora file' }).click();
      }
      await page.setViewportSize({ width: 1280, height: 800 });
      await browser.getByRole('button', { name: 'data.json', exact: true }).click();
      await expect(browser.getByRole('tab')).toHaveCount(2);
      await expect(browser.getByText(/dirty checkout/)).toHaveCount(0);
      const older = (await repo.git(['rev-parse', 'main^'])).stdout.trim();
      await repo.git(['update-ref', 'refs/heads/main', older]);
      await fixture.cli(['daemon', 'stop']);
      await browser.getByRole('tab', { name: 'index.ts', exact: true }).click();
      await expect(browser.getByText(/Snapshot main/)).toBeVisible();
      await browser.getByRole('button', { name: 'Aggiorna main' }).click();
      await expect(browser.getByText(older, { exact: true })).toBeVisible();
      await expect(browser.getByRole('tab')).toHaveCount(0);
      await expect(browser.getByRole('button', { name: 'src', exact: true })).toHaveCount(0);
    } finally { await app.close(); }
  } finally { await fixture.cleanup(); }
});
