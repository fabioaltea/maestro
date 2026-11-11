import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createCliHarness } from '../fixtures/cli-harness.js';
import { createPlatformPaths } from '../../src/platform/macos/paths.js';
import { createLocalTransport } from '../../src/platform/macos/transport.js';
import { LocalClient } from '../../src/client/local-client.js';
import { createClientBackend } from '../../src/bootstrap.js';
import type { StreamEventFrame } from '../../src/protocol/messages.js';

for (const variant of ['success', 'callback-failure', 'sequence-gap'] as const) {
  test(`E3 registry client ${variant}: preserve payload and consume cursor only after successful application`, async t => {
    const h = await createCliHarness(t), adapter = createPlatformPaths(), paths = (await adapter.resolveArchive(h.archive, 'write'))!;
    const key = await adapter.createCredential(paths.clientKeyFile), instanceId = randomUUID(), storeId = randomUUID();
    let calls = 0, deliveries = 0, release!: () => void, entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; }), ready = new Promise<void>(resolve => { entered = resolve; });
    const event: StreamEventFrame['event'] = { protocolVersion: 1, storeId, eventId: randomUUID(), seq: variant === 'sequence-gap' ? '2' : '1',
      occurredAt: new Date().toISOString(), instanceId, operationId: randomUUID(), type: 'operation.completed', payload: {
        scope: 'project', action: 'REGISTER', outcome: 'SUCCEEDED', effect: 'CREATED', projectId: randomUUID(), configRevision: '9007199254740993', observationRevision: '1' } };
    const server = await createLocalTransport().listen(paths.daemonEndpoint, instanceId, new Map([[key, 'client']]), async (request, peer) => {
      if (request.method === 'subscription.close') return { protocolVersion: 1, correlationId: request.correlationId, result: 'OK', data: { closed: true } };
      assert.equal(request.method, 'events.subscribe', 'no hidden control or registry retry'); calls++;
      const subscriptionId = randomUUID();
      peer.channel!.afterReply(() => peer.channel!.write(Buffer.from(JSON.stringify({ protocolVersion: 1, kind: 'event', correlationId: request.correlationId,
        instanceId, subscriptionId, event }) + '\n')));
      return { protocolVersion: 1, correlationId: request.correlationId, result: 'OK', data: { subscriptionId, storeId, instanceId, highWater: '0' } };
    });
    try {
      const client = new LocalClient(createClientBackend());
      const subscription = await client.followEvents(async frame => {
        deliveries++; assert.deepEqual(frame.event, event); entered();
        if (variant === 'sequence-gap') return;
        if (variant === 'callback-failure') throw new Error('private callback failure');
        await gate;
      }, { stateDirectory: h.archive });
      if (variant === 'sequence-gap') {
        const result = await Promise.race([subscription.done, new Promise<{ reason: string; lastReceived: null }>(resolve => setTimeout(() => resolve({ reason: 'ACCEPTED_GAP', lastReceived: null }), 250))]);
        await subscription.close(); assert.equal(result.reason, 'INVALID_REQUEST'); assert.equal(result.lastReceived, null); assert.equal(deliveries, 0);
      } else if (variant === 'callback-failure') {
        const result = await subscription.done; assert.equal(result.reason, 'INVALID_REQUEST'); assert.equal(result.lastReceived, null);
      } else {
        await ready; assert.equal(subscription.lastReceived, null); release();
        const deadline = performance.now() + 2_000;
        while (!subscription.lastReceived) { assert.ok(performance.now() < deadline); await new Promise(resolve => setTimeout(resolve, 5)); }
        assert.deepEqual(subscription.lastReceived, { storeId, seq: '1' }); await subscription.close();
        assert.equal((await subscription.done).lastReceived, '1');
      }
      assert.equal(calls, 1);
    } finally { release(); await server.close(); }
  });
}
