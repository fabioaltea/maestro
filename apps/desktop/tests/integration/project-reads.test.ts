import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { access } from 'node:fs/promises';
import { ArchiveContext } from '../../src/main/archive-context.ts';
import { ArchiveReader } from '../../src/main/read-handlers.ts';
import { CoreCli } from '../../src/main/core-cli.ts';
import { validateRuntime } from '../../src/main/runtime.ts';
import { createScratch, repositoryRoot } from '../fixtures/desktop.ts';
test('selected archive reads real live and historical registry without writing offline', async () => {
  const f = await createScratch();
  const client = new CoreCli(await validateRuntime(process.execPath, join(repositoryRoot, 'dist/cli/main.js')));
  try {
    const context = new ArchiveContext(); await context.select(f.archive);
    const reader = new ArchiveReader(context, client);
    assert.equal((await reader.read('status')).liveness, 'ABSENT_VERIFIED');
    await assert.rejects(() => access(f.archive));
    assert.equal((await f.cli(['daemon', 'start'])).result.outcome, 'SUCCEEDED');
    const repo = await f.repository('repo con spazi');
    const registration = (await f.cli(['project', 'add', repo.path])).result;
    assert.equal(registration.outcome, 'SUCCEEDED');
    const projectId = registration.data.projectId as string;
    const list = await reader.read('listProjects');
    assert.equal(list.freshness, 'LIVE'); assert.equal((list.data.projects as unknown[]).length, 1);
    const detail = await reader.read('getProject', { projectId });
    const project = detail.data.project as Record<string, any>;
    assert.equal(project.observation.freshness, 'LAST_KNOWN');
    assert.equal((await f.cli(['daemon', 'stop'])).result.outcome, 'SUCCEEDED');
    const snapshot = await f.snapshot(f.archive);
    assert.equal((await reader.read('listProjects')).freshness, 'LAST_KNOWN');
    assert.equal((await reader.read('getProject', { projectId })).freshness, 'LAST_KNOWN');
    assert.deepEqual(await f.snapshot(f.archive), snapshot);
  } finally { client.close(); await f.cleanup(); }
});
test('archive context fences a reply from an old selection', async () => {
  const f = await createScratch();
  try {
    const context = new ArchiveContext(); await context.select(f.archive);
    let resolve!: (v: unknown) => void;
    const gate = new Promise(r => { resolve = r; });
    const reader = new ArchiveReader(context, { async call() { return await gate as never; }, close() {} });
    const result = reader.read('status');
    await context.select(join(f.directory, 'other'));
    resolve({ storeId: null });
    await assert.rejects(() => result, { message: 'STALE_CONTEXT' });
  } finally { await f.cleanup(); }
});
