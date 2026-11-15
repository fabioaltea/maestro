import test from 'node:test';
import assert from 'node:assert/strict';
import { ClientLifecycle } from '../../src/main/client-lifecycle.ts';
test('archive change invalidates client scope; disposal closes only owned clients exactly once', () => {
  const counts = { archive: 0, clients: 0, recovery: 0, confirmations: 0 };
  const lifecycle = new ClientLifecycle({ closeClient: () => { counts.clients++; }, closeRecovery: () => { counts.recovery++; }, invalidateConfirmations: () => { counts.confirmations++; } });
  lifecycle.addArchiveCleanup(() => { counts.archive++; });
  lifecycle.archiveChanged();
  assert.deepEqual(counts, { archive: 1, clients: 0, recovery: 0, confirmations: 1 });
  lifecycle.addArchiveCleanup(() => { throw new Error('fixture cleanup fault'); });
  lifecycle.addArchiveCleanup(() => { counts.archive++; });
  lifecycle.dispose(); lifecycle.dispose();
  assert.deepEqual(counts, { archive: 2, clients: 1, recovery: 1, confirmations: 2 });
});
