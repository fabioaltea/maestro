import test from 'node:test';
import assert from 'node:assert/strict';
import { createDiscoveryReadFence } from '../../src/renderer/state/discovery-fence.ts';
test('late pages and callbacks cannot cross archive, project, run or revision changes', async () => {
  const original = { epoch: 1, storeId: 'store-a', projectId: 'project-a', discoveryId: 'discovery-a', runId: 'run-a', revisionId: 'revision-a' };
  for (const field of Object.keys(original) as (keyof typeof original)[]) {
    let current = { ...original }; const fence = createDiscoveryReadFence(original, () => current);
    let release!: () => void; const pending = new Promise<void>(resolve => { release = resolve; }); let applied = false;
    const page = (async () => { await pending; if (fence.current()) applied = true; })(); current = { ...current, [field]: field === 'epoch' ? 2 : 'different' }; release(); await page; assert.equal(applied, false, field);
  }
  const fence = createDiscoveryReadFence(original, () => original); assert.equal(fence.current(), true); fence.close(); assert.equal(fence.current(), false);
});
