import { test, expect } from '@playwright/test';
import { lstat, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createScratch } from '../fixtures/desktop.ts';
import { launchDesktop, chooseDirectory, openSetting } from '../fixtures/electron.ts';

test('Desktop links Codex before opening a repository and reuses the session on restart', async () => {
  const fixture = await createScratch();
  try {
    const node = join(fixture.directory, 'node-fixture');
    const log = join(fixture.directory, 'account-commands');
    const linked = join(fixture.directory, 'account-linked');
    await writeFile(node, `#!${process.execPath}
const { appendFileSync, existsSync, writeFileSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2);
if (args[1] === 'codex') {
  const action = args[2];
  appendFileSync(${JSON.stringify(log)}, action + '\\n');
  if (action === 'login') writeFileSync(${JSON.stringify(linked)}, '');
  if (action === 'configure') {
    console.log(JSON.stringify({ state: 'BLOCKED', code: 'PROVIDER_UNSAFE' }));
  } else {
    console.log(JSON.stringify({ state: existsSync(${JSON.stringify(linked)}) ? 'CONNECTED' : 'AUTH_REQUIRED',
      version: '0.167.0', binary: '/qualified/codex' }));
  }
} else {
  const result = spawnSync(process.execPath, args, { stdio: 'inherit' });
  process.exit(result.status ?? 1);
}
`, { mode: 0o700 });
    const commands = async () => (await readFile(log, 'utf8')).trim().split('\n');
    const { app, page } = await launchDesktop(fixture, fixture.archive, { node });
    try {
      await expect(page.getByRole('button', { name: 'Apri repository', exact: true })).toBeEnabled();
      await expect(page.getByRole('region', { name: 'Account Codex' })).toHaveCount(0);
      await openSetting(page, 'Diagnostica');
      const link = page.getByRole('button', { name: 'Collega Codex', exact: true });
      await expect(link).toBeVisible();
      expect(await commands()).toEqual(['status']);
      await expect(lstat(fixture.archive)).rejects.toMatchObject({ code: 'ENOENT' });
      await link.click();
      await expect(link).toHaveCount(0);
      await expect.poll(commands).toEqual(['status', 'login']);
      await expect(lstat(fixture.archive)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally { await app.close(); }

    const repo = await fixture.repository();
    const restarted = await launchDesktop(fixture, fixture.archive, { node });
    try {
      const { page } = restarted;
      await expect.poll(commands).toEqual(['status', 'login', 'status']);
      await expect(page.getByRole('button', { name: 'Collega Codex', exact: true })).toHaveCount(0);
      await chooseDirectory(restarted.app, repo.path);
      await page.getByRole('button', { name: 'Apri repository', exact: true }).click();
      await page.getByRole('button', { name: 'Analizza codebase', exact: true }).click();
      await expect(page.getByText('Account Codex collegato. Il controllo di sicurezza di Maestro blocca l’analisi.', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Avvia Discovery', exact: true })).toBeDisabled();
      await expect(page.getByRole('button', { name: 'Scegli binario Codex', exact: true })).toHaveCount(0);
      await expect.poll(commands).toEqual(['status', 'login', 'status', 'configure']);
      await openSetting(page, 'Diagnostica');
      await expect(page.getByText('Account Codex collegato.')).toBeVisible();
      await expect(page.getByText('Versione Codex CLI 0.167.0')).toBeVisible();
    } finally { await restarted.app.close(); }
  } finally { await fixture.cleanup(); }
});
