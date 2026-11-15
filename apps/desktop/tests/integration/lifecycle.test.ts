import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { ActionService } from '../../src/main/action-handlers.ts';
import { OperationRecovery } from '../../src/main/operation-recovery.ts';
import { ReceiptStore } from '../../src/main/receipt-store.ts';
import { ArchiveContext } from '../../src/main/archive-context.ts';
import { CoreCli } from '../../src/main/core-cli.ts';
import { validateRuntime } from '../../src/main/runtime.ts';
import { createScratch, repositoryRoot } from '../fixtures/desktop.ts';
test('real lifecycle controls use one durable ID, client close leaves daemon running and recovery queries old work', async () => {
  const f = await createScratch();
  const runtime = await validateRuntime(process.execPath, join(repositoryRoot, 'dist/cli/main.js'));
  const core = new CoreCli(runtime);
  try {
    const context = new ArchiveContext(); await context.select(f.archive);
    const receipts = new ReceiptStore(join(f.userData, 'receipts'));
    const service = new ActionService({ context, core, receipts, owner: () => ({ owner: 1, frame: 1 }) });
    const start = await service.prepare('daemon.start', {});
    const [first, duplicate] = await Promise.allSettled([service.confirm(start.confirmationId), service.confirm(start.confirmationId)]);
    assert.equal(first.status, 'fulfilled'); assert.equal(duplicate.status, 'rejected');
    if (first.status !== 'fulfilled') throw new Error('start failed');
    assert.equal(first.value.result.outcome, 'SUCCEEDED'); assert.equal(first.value.receipt.phase, 'TERMINAL');
    core.close();
    assert.equal((await f.cli(['daemon', 'status'])).result.liveness, 'LIVE_VERIFIED');
    const reopened = new CoreCli(runtime);
    try {
      await new OperationRecovery(new ReceiptStore(receipts.directory), reopened).reconcileAll();
      const next = new ActionService({ context, core: reopened, receipts, owner: () => ({ owner: 2, frame: 2 }) });
      const restart = await next.prepare('daemon.restart', {});
      assert.equal((await next.confirm(restart.confirmationId)).result.outcome, 'SUCCEEDED');
      const stop = await next.prepare('daemon.stop', {});
      assert.equal((await next.confirm(stop.confirmationId)).result.outcome, 'SUCCEEDED');
      assert.equal((await f.cli(['daemon', 'status'])).result.liveness, 'ABSENT_VERIFIED');
      assert.equal((await receipts.list()).length, 3);
    } finally { reopened.close(); }
  } finally { core.close(); await f.cleanup(); }
});
