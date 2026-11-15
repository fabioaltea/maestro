import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ProjectActions } from '../../src/main/project-actions.ts';
import { ArchiveContext } from '../../src/main/archive-context.ts';
import { ActionService } from '../../src/main/action-handlers.ts';
import { ReceiptStore } from '../../src/main/receipt-store.ts';
import { createScratch } from '../fixtures/desktop.ts';
import { join } from 'node:path';
test('only a current picker handle can authorize an import path; patch omissions and null remain distinct', async () => {
  const f = await createScratch();
  try {
    const context = new ArchiveContext(); await context.select(f.archive);
    const actions = new ProjectActions(context, { async chooseDirectory() { return f.directory; } });
    const chosen = await actions.chooseRepository(); assert.ok(chosen);
    const imported = await actions.resolve('project.register', { repositoryHandle: chosen!.repositoryHandle });
    assert.equal(imported.params?.path, f.directory);
    await assert.rejects(() => actions.resolve('project.register', { repositoryHandle: chosen!.repositoryHandle, path: '/etc' }));
    const projectId = randomUUID();
    const clear = await actions.resolve('project.update', { projectId, expectedRevision: '2', patch: { baseBranch: null } });
    assert.deepEqual(clear.params?.patch, { baseBranch: null });
    const keep = await actions.resolve('project.update', { projectId, expectedRevision: '2', patch: { name: 'Nuovo nome' } });
    assert.deepEqual(keep.params?.patch, { name: 'Nuovo nome' });
    await context.select(join(f.directory, 'other'));
    await assert.rejects(() => actions.resolve('project.register', { repositoryHandle: chosen!.repositoryHandle }));
  } finally { await f.cleanup(); }
});
test('offline project mutation has no effect and creates no operation receipt', async () => {
  const f = await createScratch();
  try {
    const context = new ArchiveContext(); await context.select(f.archive);
    const receipts = new ReceiptStore(join(f.userData, 'receipts')); let effects = 0;
    const service = new ActionService({ context, receipts, owner: () => ({ owner: 1, frame: 2 }), core: {
      async call(c) { if (c.action !== 'status') effects++; return { protocolVersion: 1, storeId: null, instanceId: null, requestId: null, result: 'OK', outcome: null, liveness: 'ABSENT_VERIFIED', freshness: 'LAST_KNOWN', data: {}, error: null }; }, close() {},
    } });
    service.resolveProject = (action, params) => new ProjectActions(context, { async chooseDirectory() { return null; } }).resolve(action, params);
    await assert.rejects(() => service.prepare('project.remove', { projectId: randomUUID(), expectedRevision: '1' }));
    assert.equal(effects, 0); assert.equal((await receipts.list()).length, 0);
  } finally { await f.cleanup(); }
});
