import test from 'node:test';
import assert from 'node:assert/strict';
import { lstat } from 'node:fs/promises';
import { createCliHarness, invokeCli } from '../fixtures/cli-harness.js';

test('local help/version and invalid commands are available without initializing state', async () => {
  const help = await invokeCli(['--help']);
  assert.equal(help.code, 0, help.stderr);
  assert.match(help.stdout, /maestro daemon/);
  const version = await invokeCli(['--version']);
  assert.equal(version.stdout.trim(), '0.1.0');
  const invalid = await invokeCli(['daemon', 'shell', '--json']);
  assert.equal(invalid.code, 2);
  assert.equal(JSON.parse(invalid.stdout).error.code, 'INVALID_REQUEST');
});

test('status of an absent archive is read-only and live readiness follows a verified start', async (t) => {
  const harness = await createCliHarness(t);
  const absent = await harness.call('status');
  assert.equal(absent.code, 0, absent.stderr);
  assert.equal(JSON.parse(absent.stdout).data.status, 'ABSENT');
  await assert.rejects(lstat(harness.archive), { code: 'ENOENT' });
  const started = await harness.call('start');
  assert.equal(started.code, 0, started.stdout || started.stderr);
  const status = JSON.parse((await harness.call('status')).stdout);
  assert.equal(status.data.ready, true);
  assert.equal(status.freshness, 'LIVE');
  const stopped = await harness.call('stop');
  assert.equal(stopped.code, 0, stopped.stdout);
  const again = await harness.call('stop');
  assert.equal(again.code, 0);
  assert.equal(JSON.parse((await harness.call('status')).stdout).data.ready, false);
});
