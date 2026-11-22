import test from 'node:test';
import assert from 'node:assert/strict';
import { createProcessSandbox } from '../fixtures/process-sandbox.js';

test('test processes self-exit on their private channel and cannot control another sandbox child', async (t) => {
  const first = await createProcessSandbox(t);
  const second = await createProcessSandbox(t);
  const crash = first.spawnFixture('controlled-child.js');
  const survivor = second.spawnFixture('controlled-child.js');
  await Promise.all([first.waitForMessage(crash, 'ready'), second.waitForMessage(survivor, 'ready')]);
  await assert.rejects(first.requestExit(survivor, 'crash'), /UNOWNED_PROCESS/);
  assert.equal(survivor.exitCode, null);
  assert.equal(await first.requestExit(crash, 'crash'), 86);
  assert.equal(await second.requestExit(survivor, 'shutdown'), 0);
  assert.throws(() => first.spawnFixture('../outside.js'), /INVALID_FIXTURE/);
});
