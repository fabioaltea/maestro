import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createProjectHarness } from '../fixtures/project-client.js';
import { createPlatformPaths } from '../../src/platform/macos/paths.js';
import { createLocalTransport } from '../../src/platform/macos/transport.js';
import { openStorage } from '../../src/storage/worker.js';
import { observationStore } from '../fixtures/project-observation.js';
import { createEventPump } from '../../src/protocol/event-pump.js';
import type { EventRecord } from '../../src/ports/storage.js';
import type { EventSubscription } from '../../src/ports/platform.js';

async function until(check: () => boolean | Promise<boolean>, timeout = 5_000) {
  const end = performance.now() + timeout;
  while (!await check()) { assert.ok(performance.now() < end, 'stream condition deadline'); await new Promise(resolve => setTimeout(resolve, 10)); }
}

test('E3 ten actual clients replay then observe all registry actions, disconnect and resume across restart', async t => {
  const a = await createProjectHarness(t), paths = (await createPlatformPaths().resolveArchive(a.h.archive, 'read'))!;
  const key = await createPlatformPaths().readCredential(paths.clientKeyFile), transport = createLocalTransport();
  const storeId = JSON.parse((await a.h.call('status')).stdout).storeId as string;
  const sessions: EventSubscription[] = [], histories: EventRecord[][] = [];
  try {
    for (let i = 0; i < 10; i++) {
      const history: EventRecord[] = []; histories.push(history);
      sessions.push(await transport.subscribe(paths.daemonEndpoint, key, { protocolVersion: 1, correlationId: randomUUID(), method: 'events.subscribe', params: { after: { storeId, seq: '0' } } }, async frame => { history.push(frame.event); }));
    }
    await assert.rejects(transport.subscribe(paths.daemonEndpoint, key, { protocolVersion: 1, correlationId: randomUUID(), method: 'events.subscribe', params: {} }, async () => {}), /BUSY/);
    const created = await a.register(await a.f.createRepository('stream-all-actions'));
    for (const [action, params] of [['verify', { projectId: created.projectId }], ['update', { projectId: created.projectId, expectedRevision: '1', patch: { name: 'Streamed' } }],
      ['remove', { projectId: created.projectId, expectedRevision: '2' }]] as const) assert.equal((await a.client.runProject(action, params, { stateDirectory: a.h.archive })).outcome, 'SUCCEEDED');
    await until(() => histories.every(records => records.some(event => event.payload.action === 'REMOVE' && event.type === 'operation.completed')));
    for (const records of histories) {
      assert.deepEqual(records.map(record => record.seq), records.map((_record, i) => String(i + 1)));
      for (const action of ['REGISTER', 'VERIFY', 'UPDATE', 'REMOVE']) assert.equal(records.filter(event => event.payload.action === action && event.type === 'operation.completed').length, 1);
    }
    const saved = sessions[0]!.lastReceived!; await sessions[0]!.close(); assert.equal((await a.h.call('status')).code, 0);
    assert.equal((await a.h.call('restart')).code, 0); await Promise.all(sessions.slice(1).map(session => session.done));
    const resumed: EventRecord[] = [];
    const next = await transport.subscribe(paths.daemonEndpoint, key, { protocolVersion: 1, correlationId: randomUUID(), method: 'events.subscribe', params: { after: saved } }, async frame => { resumed.push(frame.event); }); sessions.push(next);
    await until(() => resumed.at(-1)?.seq === next.highWater);
    assert.deepEqual(resumed.map(record => record.seq), resumed.map((_record, i) => String(BigInt(saved.seq) + BigInt(i + 1))));
    assert.equal((await a.h.call('stop')).code, 0); await next.done;
  } finally { await Promise.all(sessions.map(session => session.close())); }
});

test('E3 a physical post-commit pending tail is not streamed until journal drain is acknowledged', async t => {
  let fault = false;
  const f = await observationStore(t, point => { if (fault && point === 'journal.allocated') throw new Error('controlled drain failure'); });
  const boundary = f.store.getEventState().highWater, intent = { ...f.intent('REMOVE', { projectId: f.projectId, expectedRevision: '1' }), projectId: f.projectId };
  f.store.acceptProjectOperation(intent); const afterAdmission = f.store.getEventState().highWater;
  fault = true; f.store.commitProjectRemoval({ requestId: intent.requestId, instanceId: f.instanceId, projectId: f.projectId, expectedConfigRevision: '1', completedAt: new Date().toISOString() });
  const delivered: EventRecord[] = [];
  const sink = { bufferedBytes: 0, needsDrain: false, closed: false, write(bytes: Uint8Array) { delivered.push(JSON.parse(Buffer.from(bytes).toString()).event); return true; },
    waitDrain: async () => {}, end() { this.closed = true; }, onClose: () => () => {} };
  const pump = createEventPump({ storeId: f.storeId, instanceId: f.instanceId, subscriptionId: randomUUID(), correlationId: randomUUID(), after: afterAdmission, sink,
    readPage: async (after, maxBytes) => f.store.listEvents({ after, maxBytes }) });
  pump.start(); await new Promise(resolve => setTimeout(resolve, 75)); assert.equal(delivered.length, 0); assert.ok(BigInt(afterAdmission) > BigInt(boundary));
  fault = false; f.store.drainEvents(); pump.wake(); await until(() => delivered.length === 1);
  assert.equal(delivered[0]!.operationId, intent.requestId); assert.equal(delivered[0]!.payload.effect, 'REMOVED'); pump.close(); await pump.done;
});

test('E3 stalled registry observer is evicted within existing buffer/deadline limits while a healthy client progresses', async t => {
  const a = await createProjectHarness(t), paths = (await createPlatformPaths().resolveArchive(a.h.archive, 'read'))!;
  const transport = createLocalTransport(), key = await createPlatformPaths().readCredential(paths.clientKeyFile), writer = await openStorage({ path: paths.stateFile });
  let latest = '0';
  const fast = await transport.subscribe(paths.daemonEndpoint, key, { protocolVersion: 1, correlationId: randomUUID(), method: 'events.subscribe', params: {} }, async frame => { latest = frame.event.seq; });
  const slow = await transport.subscribe(paths.daemonEndpoint, key, { protocolVersion: 1, correlationId: randomUUID(), method: 'events.subscribe', params: {} }, () => new Promise(() => {}));
  try {
    for (let batch = 0; batch < 80; batch++) await writer.recordEvents(Array.from({ length: 80 }, () => ({ type: 'operation.failed' as const, operationId: randomUUID(), payload: {
      scope: 'project', action: 'VERIFY', projectId: randomUUID(), outcome: 'FAILED', effect: 'NONE', code: 'REVISION_CONFLICT', configRevision: '9007199254740993', observationRevision: '9007199254740993' } })));
    const highWater = (await writer.getEventState()).highWater; await until(() => BigInt(latest) >= BigInt(highWater));
    await until(async () => {
      const result = JSON.parse((await a.h.call('diagnostics')).stdout).data.subscriptions;
      return result.recent.some((item: { subscriptionId: string; reason: string }) => item.subscriptionId === slow.subscriptionId && item.reason === 'SLOW_CONSUMER');
    });
    const diagnostics = JSON.parse((await a.h.call('diagnostics')).stdout).data.subscriptions;
    for (const item of [...diagnostics.active, ...diagnostics.recent]) assert.ok(item.peakBufferedBytes <= 1024 * 1024);
    assert.equal((await a.h.call('status')).code, 0);
  } finally { await slow.close(); await fast.close(); await writer.close(); }
});
