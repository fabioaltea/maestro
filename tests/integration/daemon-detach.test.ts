import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createCliHarness, cliFile } from '../fixtures/cli-harness.js';
import { createProcessSandbox } from '../fixtures/process-sandbox.js';

test('daemon survives the closing of the launching pseudo-terminal', async (t) => {
  const harness = await createCliHarness(t);
  const terminal = spawnSync('/usr/bin/script', ['-q', '/dev/null', process.execPath, cliFile,
    'daemon', 'start', '--state-dir', harness.archive, '--json'], { encoding: 'utf8', timeout: 35_000, stdio: ['ignore', 'pipe', 'pipe'] });
  assert.equal(terminal.status, 0, terminal.stderr + terminal.stdout);
  const first = JSON.parse((await harness.call('status')).stdout);
  assert.equal(first.data.ready, true);
  const second = JSON.parse((await harness.call('status')).stdout);
  assert.equal(second.instanceId, first.instanceId);
});

test('terminating the actual CLI execution process does not terminate its daemon', async (t) => {
  const sandbox = await createProcessSandbox(t);
  const harness = await createCliHarness(t);
  const cli = sandbox.spawnFixture('cli-launcher.js', [harness.archive]);
  await sandbox.waitForMessage(cli, 'ready', 15_000);
  const before = JSON.parse((await harness.call('status')).stdout);
  assert.equal(before.data.ready, true);
  assert.equal(await sandbox.requestExit(cli, 'crash'), 86);
  const after = JSON.parse((await harness.call('status')).stdout);
  assert.equal(after.data.ready, true);
  assert.equal(after.instanceId, before.instanceId);
});
