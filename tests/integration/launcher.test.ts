import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { createDaemonLauncher } from '../../src/platform/macos/launcher.js';
import { createTestContext } from '../fixtures/test-context.js';

test('detached launcher transfers one bounded intent and reports acceptance independently of stdio', async (t) => {
  const context = await createTestContext(t);
  const controllerFile = fileURLToPath(new URL('../fixtures/launch-receiver.js', import.meta.url));
  const launcher = createDaemonLauncher({ controllerFile });
  const intent = { protocolVersion: 1 as const, action: 'start' as const,
    requestId: '5fc02636-f95e-4ee8-9969-2a7e0c2478f0', canonicalStateDir: context.directory };
  const observed = await launcher.spawnController(intent);
  assert.ok(observed.pid > 0);
  assert.deepEqual(await observed.bootstrap, { accepted: true });
  assert.deepEqual(await observed.exit, { code: 0, signal: null });
  assert.deepEqual(JSON.parse(await readFile(join(context.directory, 'received.json'), 'utf8')), intent);
});
