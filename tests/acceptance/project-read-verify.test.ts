import test from 'node:test';
import assert from 'node:assert/strict';
import { rename, lstat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createProjectHarness } from '../fixtures/project-client.js';
import { invokeCli } from '../fixtures/cli-harness.js';
import { snapshotArchive } from '../fixtures/archive-snapshot.js';
import type { ProjectDetail } from '../../src/ports/registry.js';

interface Result { freshness: string; outcome: string; error: { code: string } | null;
  data: { projectId: string; effect: string; projects: ProjectDetail[]; nextCursor: string | null; project: ProjectDetail } }

test('US2: independent CLI clients preserve all confirmed projects/config/dates across verify, restart and zero-write offline reads', async t => {
  const a = await createProjectHarness(t), main = await a.f.createRepository('acceptance-main');
  await a.f.makeDirty(main);
  const empty = await a.f.createRepository('acceptance-empty', { commit: false });
  const common = await a.f.createRepository('acceptance-common'), linked = await a.f.addWorktree(common, 'acceptance-linked');
  const ids = [];
  for (const repo of [main, empty, linked]) ids.push((await a.register(repo)).projectId!);
  const original = await Promise.all(ids.map(id => a.get(id)));
  await rename(linked, linked + '.saved');
  const source = await snapshotArchive(a.f.directory);
  const verified = await invokeCli(['project', 'verify', ids[2]!, '--state-dir', a.h.archive, '--json']);
  assert.equal(verified.code, 0, verified.stdout || verified.stderr);
  const result = JSON.parse(verified.stdout) as Result;
  assert.equal(result.outcome, 'SUCCEEDED'); assert.equal(result.data.effect, 'OBSERVED');
  const saved = await Promise.all(ids.map(id => a.get(id)));
  assert.equal(saved[2]!.observation.checkoutAvailability, 'UNAVAILABLE');
  assert.equal(saved[2]!.observation.trackedChanges, null); assert.ok(saved[2]!.observation.error);
  for (let i = 0; i < ids.length; i++) {
    const before = original[i]!, after = saved[i]!;
    assert.deepEqual({ id: after.projectId, name: after.displayName, base: after.baseBranch, reference: after.referenceCheckout,
      configRevision: after.configRevision, createdAt: after.createdAt, updatedAt: after.updatedAt },
    { id: before.projectId, name: before.displayName, base: before.baseBranch, reference: before.referenceCheckout,
      configRevision: before.configRevision, createdAt: before.createdAt, updatedAt: before.updatedAt });
  }
  assert.equal((await a.h.call('restart')).code, 0);
  assert.deepEqual(await Promise.all(ids.map(id => a.get(id))), saved);
  assert.equal((await a.h.call('stop')).code, 0);
  const archive = await snapshotArchive(a.h.archive);
  const observed: ProjectDetail[] = []; let cursor: string | null = null;
  do {
    const page = await invokeCli(['project', 'list', '--limit', '1', ...(cursor ? ['--cursor', cursor] : []), '--state-dir', a.h.archive, '--json']);
    assert.equal(page.code, 0, page.stdout); const parsed = JSON.parse(page.stdout) as Result;
    assert.equal(parsed.freshness, 'LAST_KNOWN'); assert.ok(Buffer.byteLength(page.stdout) <= 60 * 1024);
    observed.push(...parsed.data.projects); cursor = parsed.data.nextCursor;
  } while (cursor);
  assert.deepEqual(observed, [...saved].sort((a, b) => a.projectId.localeCompare(b.projectId)));
  for (const project of saved) {
    const shown = await invokeCli(['project', 'show', project.projectId, '--state-dir', a.h.archive, '--json']);
    assert.equal(shown.code, 0, shown.stdout); assert.deepEqual((JSON.parse(shown.stdout) as Result).data.project, project);
    assert.equal(project.observation.freshness, 'LAST_KNOWN'); assert.ok(Date.parse(project.observation.completedAt));
  }
  assert.deepEqual(await snapshotArchive(a.h.archive), archive); assert.deepEqual(await snapshotArchive(a.f.directory), source);
  await assert.rejects(lstat(linked), { code: 'ENOENT' }); await lstat(join(common, '.git'));
  const absent = join(a.h.directory, 'absent-state');
  const missing = await invokeCli(['project', 'list', '--state-dir', absent, '--json']);
  assert.equal((JSON.parse(missing.stdout) as Result).error!.code, 'STATE_ABSENT'); await assert.rejects(lstat(absent), { code: 'ENOENT' });
  await writeFile(resolve('specs/002-project-registry/reports/us2-preservation-samples.json'), JSON.stringify({
    measuredAt: new Date().toISOString(), confirmed: ids.length, preserved: ids.length, configurationsPreservedPercent: 100,
    referenceFallbacks: 0, offlineWrites: 0, sourceUnchanged: true,
    projects: saved.map(p => ({ projectId: p.projectId, configRevision: p.configRevision, baseBranch: p.baseBranch,
      observationRevision: p.observation.observationRevision, completedAt: p.observation.completedAt, freshness: p.observation.freshness })),
  }, null, 2) + '\n');
});
