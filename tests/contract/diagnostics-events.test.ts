import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, lstat } from 'node:fs/promises';
import { createCliHarness, invokeCli } from '../fixtures/cli-harness.js';
import { createPlatformPaths } from '../../src/platform/macos/paths.js';
import { createLocalTransport } from '../../src/platform/macos/transport.js';

test('diagnostics and event pages are read-only offline and absent archives are not initialized', async t => {
  const h = await createCliHarness(t);
  for (const command of ['diagnostics', 'events']) {
    const result = await h.call(command);
    assert.equal(result.code, 0, result.stdout);
    assert.equal(JSON.parse(result.stdout).data.status, 'ABSENT');
  }
  await assert.rejects(lstat(h.archive), {code: 'ENOENT'});
  assert.equal((await h.call('start')).code, 0);
  assert.equal((await h.call('stop')).code, 0);
  const before = JSON.parse((await h.call('status')).stdout).data.revision;
  const diag = await h.call('diagnostics');
  assert.equal(diag.code, 0, diag.stdout);
  const data = JSON.parse(diag.stdout).data;
  assert.equal(data.versions.protocol, 1);
  assert.equal(typeof data.observability.highWater, 'string');
  assert.equal(data.observability.pendingBytes, 0);
  const events = await h.call('events', '--limit', '2');
  assert.equal(events.code, 0, events.stdout);
  const page = JSON.parse(events.stdout).data.events;
  assert.equal(page.records.length, 2);
  assert.equal(page.truncated, true);
  for (const event of page.records) {
    assert.equal(event.protocolVersion, 1);
    assert.equal(typeof event.seq, 'string');
    assert.ok(event.eventId && event.storeId && event.operationId);
    assert.ok(event.type.startsWith('operation.'));
  }
  assert.ok(Buffer.byteLength(events.stdout) <= 65_536);
  assert.equal(JSON.parse((await h.call('status')).stdout).data.revision, before);
  const human = await invokeCli(['daemon', 'diagnostics', '--state-dir', h.archive]);
  assert.equal(human.code, 0);
  assert.match(human.stdout, /STOPPED/);
  assert.equal((await h.call('events', '--limit', '1001')).code, 2);
  assert.equal((await h.call('events', '--follow')).code, 2);
});

test('authenticated diagnostics/events RPC preserve correlation and redact capabilities', async t => {
  const h = await createCliHarness(t);
  assert.equal((await h.call('start')).code, 0);
  const paths = (await createPlatformPaths().resolveArchive(h.archive, 'read'))!;
  const key = (await readFile(paths.clientKeyFile, 'utf8')).trim();
  for (const method of ['diagnostics.get', 'events.list']) {
    const correlationId = randomUUID();
    const response = await createLocalTransport().call(paths.daemonEndpoint, key, {protocolVersion: 1, correlationId, method, params: {}}, 1_000);
    assert.equal(response.result, 'OK');
    assert.equal(response.correlationId, correlationId);
    assert.doesNotMatch(JSON.stringify(response), new RegExp(key));
    assert.doesNotMatch(JSON.stringify(response), /credentialRef|client\.key/);
  }
  await assert.rejects(createLocalTransport().call(paths.daemonEndpoint, 'a'.repeat(64), {protocolVersion: 1, correlationId: randomUUID(), method: 'diagnostics.get', params: {}}, 1_000), /UNAUTHORIZED/);
});
