import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createScratch } from '../fixtures/desktop.ts';
import { seedWaitingDiscovery } from '../fixtures/discovery-session.ts';
import { launchDesktop } from '../fixtures/electron.ts';

test('startup restores the open repository and shows recents above the open action after closing it', async () => {
  const f = await createScratch();
  try {
    await f.cli(['daemon', 'start']);
    const repo = await f.repository('Archivio locale');
    await f.cli(['project', 'add', repo.path]);
    const first = await launchDesktop(f);
    try {
      await first.page.getByRole('button', { name: /^Archivio locale / }).click();
      await expect(first.page.getByRole('article', { name: 'Dettaglio Archivio locale' })).toBeVisible();
      await expect(first.page.getByRole('heading', { name: 'Recenti', exact: true })).toHaveCount(0);
    } finally { await first.app.close(); }

    const reopened = await launchDesktop(f);
    try {
      const { page } = reopened;
      await expect(page.getByRole('article', { name: 'Dettaglio Archivio locale' })).toBeVisible();
      await page.getByRole('button', { name: 'Chiudi repository', exact: true }).click();
      const recent = page.getByRole('button', { name: /^Archivio locale / });
      await expect(recent).toBeVisible();
      const row = (await recent.boundingBox())!;
      const open = (await page.getByRole('button', { name: 'Apri repository', exact: true }).boundingBox())!;
      expect(open.y).toBeGreaterThan(row.y + row.height);
      await page.reload();
      await expect(recent).toBeVisible();
      await expect(page.getByRole('article', { name: 'Dettaglio Archivio locale' })).toHaveCount(0);
    } finally { await reopened.app.close(); }
  } finally { await f.cleanup(); }
});

test('switching to Agents follows new output on the same Discovery run', async () => {
  const f = await createScratch();
  try {
    const seed = await seedWaitingDiscovery(f);
    const node = join(f.directory, 'node-fixture'), progress = join(f.directory, 'discovery-progress');
    // Forward the real local CLI, varying only read replies for the fixture run.
    await writeFile(node, `#!${process.execPath}
const { createHash } = require('node:crypto');
const { existsSync, readFileSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2), [cli, namespace, action] = args;
if (namespace !== 'discovery' || !['list', 'show', 'output'].includes(action)) {
  const call = spawnSync(process.execPath, args, { stdio: 'inherit' });
  process.exit(call.status ?? 1);
}
const call = spawnSync(process.execPath, [cli, ...args.slice(1)], { encoding: 'utf8' });
const reply = JSON.parse(call.stdout);
if (reply.result === 'OK') {
  const rows = action === 'list' ? reply.data.items : [reply.data.discovery];
  for (const row of rows) if (row?.discoveryId === ${JSON.stringify(seed.discoveryId)}) row.state = 'RUNNING';
  const path = ${JSON.stringify(progress)}, first = reply.data.items?.[0];
  if (action === 'output' && first?.runId === ${JSON.stringify(seed.runId)} && existsSync(path)) {
    const bytes = readFileSync(path);
    reply.data.items.push({ ...first, seq: '2', kind: 'PROGRESS', data: bytes.toString('base64'),
      sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, byteLength: bytes.length });
  }
}
console.log(JSON.stringify(reply));
process.exitCode = call.status ?? 1;
`, { mode: 0o700 });
    const { app, page } = await launchDesktop(f, f.archive, { node });
    try {
      await page.getByRole('button', { name: /^Intervista UI / }).click();
      await page.getByRole('button', { name: 'Analizza codebase', exact: true }).click();
      await expect(page.getByLabel('Output Discovery')).toContainText('Analisi sintetica conservata.');
      await page.getByRole('button', { name: 'Agenti', exact: true }).click();
      const terminal = page.getByRole('region', { name: 'Terminale Discovery' });
      await expect(terminal).toContainText('In diretta');
      await expect(terminal.getByLabel('Output Discovery')).toContainText('Analisi sintetica conservata.');
      await writeFile(progress, '\nProgresso ricevuto durante la sessione.');
      await expect(terminal.getByLabel('Output Discovery')).toContainText('Progresso ricevuto durante la sessione.');
      await page.getByRole('button', { name: 'Apri Discovery', exact: true }).click();
      await expect(page.getByLabel('Output Discovery')).toContainText('Progresso ricevuto durante la sessione.');
      expect((await f.cli(['discovery', 'show', seed.discoveryId])).result.data.discovery.currentRunId).toBe(seed.runId);
    } finally { await app.close(); }
  } finally { await f.cleanup(); }
});
