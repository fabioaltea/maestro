import test from 'node:test';
import assert from 'node:assert/strict';
import { agentFixture, waitFor } from '../fixtures/discovery-agent-runtime.js';
import { createDiscoveryRecovery } from '../../src/core/discovery/recovery.js';
import { value } from '../fixtures/discovery-artifacts.js';
import type { StoragePort } from '../../src/ports/storage.js';

for (const afterGo of [false, true]) test(`G2 host SIGKILL ${afterGo ? 'after' : 'before'} GO preserves uncertain ownership and never restarts`, async t => {
  const f = await agentFixture(t, { allowUnknown: true, lifetime: 500 }), ready = value(await f.launch());
  if (afterGo) await f.authorize(ready);
  f.hosts[0]!.kill('SIGKILL'); await waitFor(() => f.hosts[0]!.signalCode !== null);
  const recovery = createDiscoveryRecovery({ storage: f.store as unknown as StoragePort, agent: f.runtime, settle: async () => {} });
  assert.equal(await recovery.recover(), false);
  const d = value(f.store.readDiscoveryMetadata({ kind: 'discovery', id: f.discovery.discoveryId })).data!;
  assert.equal(d.state, 'RECONCILING'); assert.equal(f.hosts.length, 1);
  assert.equal(value(f.store.readDiscoveryMetadata({ kind: 'process', id: f.run.runId })).data!.releaseState, 'OWNED');
  assert.equal((f.database.prepare('SELECT discovery_id FROM discovery_slot WHERE singleton=1').get() as { discovery_id: string }).discovery_id, d.discoveryId);
});
