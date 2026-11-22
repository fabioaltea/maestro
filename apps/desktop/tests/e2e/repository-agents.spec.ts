import { test, expect } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createScratch } from '../fixtures/desktop.ts';
import { seedWaitingDiscovery } from '../fixtures/discovery-session.ts';
import { launchDesktop, openSetting, repositoryNavigation } from '../fixtures/electron.ts';

test('restores the repository, navigates from the sidebar and closes from the overview', async () => {
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
      await expect(first.page.getByRole('button', { name: 'Apri repository', exact: true })).toHaveCount(0);
    } finally { await first.app.close(); }

    const reopened = await launchDesktop(f);
    try {
      const { page } = reopened;
      const detail = page.getByRole('article', { name: 'Dettaglio Archivio locale' });
      await expect(detail).toBeVisible();
      const sections = page.getByRole('complementary', { name: 'Navigazione principale' })
        .getByRole('navigation', { name: 'Sezioni repository' });
      await expect(sections.getByRole('button')).toHaveCount(5);
      await expect(sections.locator('button > svg')).toHaveCount(5);
      await expect(sections.getByRole('button', { name: 'Impostazioni', exact: true })).toHaveCount(0);
      await expect(sections.getByRole('button', { name: 'Repository', exact: true })).toHaveCount(0);
      await expect(detail.getByRole('navigation', { name: 'Sezioni repository' })).toHaveCount(0);
      const overview = sections.getByRole('button', { name: 'Panoramica', exact: true });
      const feature = sections.getByRole('button', { name: 'Feature', exact: true });
      const settings = sections.getByRole('button', { name: 'Impostazioni repository', exact: true });
      const settingsNav = page.getByRole('navigation', { name: 'Impostazioni repository' });
      const close = detail.getByRole('button', { name: 'Chiudi repository', exact: true });
      await expect(overview).toHaveAttribute('aria-current', 'page');
      await feature.press('Enter');
      await expect(feature).toHaveAttribute('aria-current', 'page');
      await expect(detail.locator('.feature-planning')).toBeVisible();
      await expect(close).toHaveCount(0);
      await overview.press('Enter');
      await expect(close).toBeVisible();
      await expect(page.getByRole('navigation', { name: 'Percorso repository' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Aggiorna repository', exact: true })).toHaveCount(0);
      await close.press('Enter');
      const recent = page.getByRole('button', { name: /^Archivio locale / });
      await expect(recent).toBeVisible();
      await expect(detail).toHaveCount(0);
      const selection = sections.getByRole('button', { name: 'Recenti', exact: true });
      await expect(sections.locator('button:disabled')).toHaveCount(4);
      await expect(selection).toBeEnabled();
      await openSetting(page, 'Diagnostica');
      await expect(page.getByRole('heading', { name: 'Diagnostica', exact: true, level: 2 })).toBeVisible();
      await selection.press('Enter');
      await expect(recent).toBeVisible();
      const row = (await recent.boundingBox())!;
      const open = (await page.getByRole('button', { name: 'Apri repository', exact: true }).boundingBox())!;
      const create = (await page.getByRole('button', { name: 'Crea repository', exact: true }).boundingBox())!;
      expect(open.y).toBeGreaterThan(row.y + row.height);
      expect(create.y).toBeGreaterThan(row.y + row.height);
      await recent.click();
      await expect(detail).toBeVisible();
      await expect(sections.locator('button:enabled')).toHaveCount(5);
      await expect(sections.getByRole('button', { name: 'Ambiente', exact: true })).toHaveCount(0);
      await settings.press('Enter');
      await expect(settingsNav.getByRole('button')).toHaveText(['Generali', 'Workspace', 'Ambiente', 'Sessioni', 'Coda', 'Revisioni']);
      await expect(settingsNav.getByRole('button', { name: 'Generali', exact: true })).toHaveAttribute('aria-current', 'page');
      await settingsNav.getByRole('button', { name: 'Ambiente', exact: true }).press('Enter');
      await expect(settings).toHaveAttribute('aria-current', 'page');
      await page.getByRole('button', { name: 'Vai ai workspace', exact: true }).click();
      await expect(page.getByRole('region', { name: 'Worktree Git' })).toBeVisible();
      await expect(settingsNav.getByRole('button', { name: 'Workspace', exact: true })).toHaveAttribute('aria-current', 'page');
      await overview.press('Enter');
      await close.press('Enter');
      await expect(recent).toBeVisible();
      await expect(settings).toBeDisabled();
      await expect(settingsNav).toHaveCount(0);
      await expect(recent).not.toHaveAttribute('aria-current', 'true');
      await page.reload();
      await expect(recent).toBeVisible();
      await expect(detail).toHaveCount(0);
      await recent.click();
      await expect(overview).toHaveAttribute('aria-current', 'page');
    } finally { await reopened.app.close(); }
  } finally { await f.cleanup(); }
});

test('the project shows the active Discovery agent and follows its terminal', async () => {
  test.setTimeout(90_000);
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
  for (const row of rows) if (row?.discoveryId === ${JSON.stringify(seed.discoveryId)}) {
    row.state = 'RUNNING';
    row.agentRun.phase = 'PROVIDER_RUNNING';
  }
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
      await repositoryNavigation(page).getByRole('button', { name: 'Agenti', exact: true }).click();
      const agents = page.getByRole('region', { name: 'Agenti attivi' });
      const architect = agents.getByRole('button', { name: /Project Architect/ });
      await expect(architect).toContainText('Codex · fixture-model', { timeout: 15_000 });
      await expect(architect).toContainText('Discovery della codebase');
      await expect(architect).toContainText('Attivo');
      await architect.click();
      const detail = page.getByRole('region', { name: 'Dettaglio agente' });
      await expect(detail).toContainText('In diretta');
      await expect(detail.getByLabel('Output Discovery')).toContainText('Analisi sintetica conservata.', { timeout: 15_000 });
      await detail.getByRole('button', { name: 'Apri Discovery', exact: true }).click();
      await expect(page.getByLabel('Output Discovery')).toContainText('Analisi sintetica conservata.', { timeout: 15_000 });
      await page.getByRole('main').evaluate(main => { main.scrollTop = main.scrollHeight; });
      await expect(repositoryNavigation(page)).toBeInViewport();
      await openSetting(page, 'Monitoraggio Discovery');
      const terminal = page.getByRole('region', { name: 'Terminale Discovery' });
      await expect(terminal).toContainText('In diretta');
      await expect(terminal.getByLabel('Output Discovery')).toContainText('Analisi sintetica conservata.');
      await writeFile(progress, '\nProgresso ricevuto durante la sessione.');
      await expect(terminal.getByLabel('Output Discovery')).toContainText('Progresso ricevuto durante la sessione.');
      await page.getByRole('button', { name: 'Apri Discovery', exact: true }).click();
      await expect(page.getByLabel('Output Discovery')).toContainText('Progresso ricevuto durante la sessione.', { timeout: 15_000 });
      expect((await f.cli(['discovery', 'show', seed.discoveryId])).result.data.discovery.currentRunId).toBe(seed.runId);
    } finally { await app.close(); }
  } finally { await f.cleanup(); }
});

test('the project identifies an implementation agent and opens its run output', async () => {
  const f = await createScratch();
  try {
    await f.cli(['daemon', 'start']);
    const repo = await f.repository('Implementazione locale');
    const project = (await f.cli(['project', 'add', repo.path])).result;
    const { projectId } = project.data;
    const [sessionId, runId, featureId, workspaceId, profileResolutionId, envelopeId, artifactId, generation] = Array.from({ length: 8 }, () => randomUUID());
    const at = new Date().toISOString(), bytes = Buffer.from('Controllo sintetico dei file della feature.\n');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const session = {
      sessionId, runId, projectId, featureId, workspaceId, profileResolutionId, envelopeId,
      state: 'RUNNING', stateRevision: '2', checkpointId: null, createdAt: at, updatedAt: at,
    };
    const agent = { runId, providerId: 'codex', modelId: 'fixture-implementation', phase: 'RUNNING', featureTitle: 'Aggiorna la ricerca' };
    const reply = { protocolVersion: 1, storeId: project.storeId, instanceId: project.instanceId, requestId: null, result: 'OK', outcome: null, freshness: 'LIVE', liveness: 'LIVE_VERIFIED', error: null };
    const data = {
      list: { items: [session], nextCursor: null, agent },
      get: { agent, session, checkpoint: null, interactions: [], checkedAt: at, run: {
        runId, sessionId, generation, providerId: 'codex', configRevision: '1', phase: 'RUNNING',
        outcome: 'IN_PROGRESS', requested: null, outputWatermark: '1', truncated: false,
      } },
      'output.list': { runId, chunks: [{ seq: '1', artifactId, sha256, bytes: bytes.length }], watermark: '1', truncated: false, nextCursor: null },
      artifact: { artifactId, sha256, totalBytes: bytes.length, offset: 0, base64: bytes.toString('base64'), nextCursor: null },
    };
    const node = join(f.directory, 'node-fixture');
    await writeFile(node, `#!${process.execPath}
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2), [, namespace, action] = args;
const replies = ${JSON.stringify(data)};
if (namespace === 'execution' && Object.hasOwn(replies, action)) {
  if (action === 'list' && !args.includes('--active-only')) process.exit(1);
  console.log(JSON.stringify({ ...${JSON.stringify(reply)}, data: { ...replies[action], freshness: 'CURRENT' } }));
} else {
  const call = spawnSync(process.execPath, args, { stdio: 'inherit' });
  process.exit(call.status ?? 1);
}
`, { mode: 0o700 });
    const { app, page } = await launchDesktop(f, f.archive, { node });
    try {
      await page.getByRole('button', { name: /^Implementazione locale / }).click();
      await repositoryNavigation(page).getByRole('button', { name: 'Agenti', exact: true }).click();
      const row = page.getByRole('region', { name: 'Agenti attivi' }).getByRole('button', { name: /Aggiorna la ricerca/ });
      await expect(row).toContainText('Codex', { timeout: 15_000 });
      await expect(row).toContainText('fixture-implementation');
      await expect(row).toContainText('Attivo');
      await row.click();
      const terminal = page.getByRole('region', { name: 'Terminale sessione agente' });
      await expect(terminal).toContainText('In diretta');
      await expect(terminal.getByLabel('Output sessione agente')).toContainText(bytes.toString('utf8').trim(), { timeout: 15_000 });
    } finally { await app.close(); }
  } finally { await f.cleanup(); }
});
