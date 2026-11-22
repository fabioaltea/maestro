import { test, expect } from '@playwright/test';
import { createScratch } from '../fixtures/desktop.ts';
import { seedWaitingDiscovery } from '../fixtures/discovery-session.ts';
import { launchDesktop } from '../fixtures/electron.ts';
test('G2 daemon loss preserves the same waiting session, output and question after UI reopen', async () => {
  const f = await createScratch();
  try {
    const seed = await seedWaitingDiscovery(f), before = await f.snapshot(seed.repo.path);
    const status = (await f.cli(['daemon', 'status'])).result;
    expect(status.liveness).toBe('LIVE_VERIFIED'); expect(status.data.lifecycle).toBe('RUNNING');
    const identity = status.instanceId, pid = status.data.pid;
    expect(Number.isSafeInteger(pid) && pid > 0 && pid !== process.pid).toBe(true);
    // The signal belongs only to this newly-created scratch daemon, after an
    // authenticated observation. No application recovery code signals a PID.
    const checked = (await f.cli(['daemon', 'status'])).result; expect(checked.instanceId).toBe(identity); expect(checked.data.pid).toBe(pid);
    process.kill(pid, 'SIGKILL');
    await expect.poll(async () => (await f.cli(['daemon', 'status'])).result.liveness).toBe('ABSENT_VERIFIED');
    expect((await f.cli(['daemon', 'start'])).result.outcome).toBe('SUCCEEDED');
    const { app, page } = await launchDesktop(f);
    try {
      await page.locator('.project-row').first().click(); await page.getByRole('button', { name: 'Analizza codebase', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Quale distribuzione è prevista?', exact: true })).toBeVisible();
      await expect(page.getByLabel('Output Discovery')).toContainText('Analisi sintetica conservata.');
      const discovery = (await f.cli(['discovery', 'show', seed.discoveryId])).result.data.discovery;
      expect(discovery.currentRunId).toBe(seed.runId); expect(discovery.state).toBe('WAITING_USER');
      expect((await f.cli(['discovery', 'list', seed.projectId])).result.data.items).toHaveLength(1);
      expect(await f.snapshot(seed.repo.path)).toEqual(before);
    } finally { await app.close(); }
  } finally { await f.cleanup(); }
});
