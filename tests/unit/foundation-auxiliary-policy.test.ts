import test from 'node:test';
import assert from 'node:assert/strict';
import { drainFoundationAuxiliaries, type AuxiliaryDrainContext } from '../../src/core/foundation-auxiliary-policy.js';
import type { ManagedResource } from '../../src/ports/storage.js';

test('uncertain identity, runtime scope and controller PID never receive shutdown commands', async () => {
  const resource: ManagedResource = { resourceId: 'test', owningInstanceId: 'instance', kind: 'auxiliary', policyScope: 'foundation', generation: '1',
    pid: 123, endpoint: '/run/aux.sock', credentialRef: '/keys/aux.key', observation: 'UNKNOWN', releaseState: 'OWNED' };
  for (const change of [{}, { policyScope: 'agent-runtime' }, { pid: 999 }, { endpoint: '/foreign/aux.sock' }]) {
    let calls = 0;
    const saved: ManagedResource[] = [];
    const context = {
      store: { listResources: async () => [{ ...resource, ...change }], saveResource: async (r: ManagedResource) => { saved.push(r); } },
      instanceId: 'instance', paths: { runtimeDirectory: '/run', credentialsDirectory: '/keys' },
      identity: { probeAbsent: async () => 'UNKNOWN', challenge: async () => 'UNKNOWN' },
      transport: { call: async () => { calls++; } }, platformPaths: { readCredential: async () => 'secret' },
      deadline: { expired: () => false, remainingMs: () => 100 }, excludedPids: [999], sleep: async () => {},
    } as unknown as AuxiliaryDrainContext;
    await assert.rejects(drainFoundationAuxiliaries(context), /RESOURCE_IDENTITY_UNKNOWN/);
    assert.equal(calls, 0);
    assert.equal(saved.at(-1)?.releaseState, 'BLOCKED');
  }
});
