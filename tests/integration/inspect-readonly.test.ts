import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { lstat } from 'node:fs/promises';
import { inspectArchive } from '../../src/core/inspect-main.js';
import { createTestContext } from '../fixtures/test-context.js';

test('core inspection of a missing archive does not bootstrap or create it', async (t) => {
  const context = await createTestContext(t);
  const archive = join(context.directory, 'absent');
  const result = await inspectArchive(archive);
  assert.equal(result.data.status, 'ABSENT');
  assert.equal(result.data.ready, false);
  assert.equal(result.instanceId, null);
  await assert.rejects(lstat(archive), { code: 'ENOENT' });
});
