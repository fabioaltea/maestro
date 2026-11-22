import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTestContext } from '../fixtures/test-context.js';

test('sandbox cleanup waits for its own cooperative child and preserves unrelated files', async (t) => {
  const context = await createTestContext(t);
  const sibling = await createTestContext(t);
  await writeFile(join(sibling.directory, 'keep'), 'untouched');
  const child = context.spawnNode(['--input-type=module', '-e', `
    process.on('message', message => {
      if (message.type === 'maestro-test-shutdown') process.exit(0);
    });
    process.send({ type: 'ready' });
  `]);
  await once(child, 'message');
  await context.cleanup();
  assert.equal(child.exitCode, 0);
  await assert.rejects(stat(context.directory), { code: 'ENOENT' });
  assert.equal((await stat(join(sibling.directory, 'keep'))).isFile(), true);
  assert.throws(() => context.spawnNode(['-e', '']), /already cleaned/);
});
