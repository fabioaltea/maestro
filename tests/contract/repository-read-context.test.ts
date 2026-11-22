import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertRepositoryIdentity } from '../../src/platform/macos/git/repository-identity-check.js';
import type { FilesystemAnchor, FilesystemIdentity } from '../../src/ports/repository.js';
import { validateRepositoryReadOutput } from '../../src/domain/projects/repository-read.js';

const root: FilesystemAnchor = {
  version: 1, canonicalPath: '/fixture', kind: 'directory', device: '1', inode: '2', birthtimeNs: '3',
};
test('repository anchors must still identify the recorded checkout', async () => {
  const filesystem: FilesystemIdentity = {
    capture: async () => ({ ...root, inode: '4' }),
    compare: (a, b) => a.inode === b.inode ? 'VERIFIED' : 'UNKNOWN',
  };
  await assert.rejects(assertRepositoryIdentity([root], filesystem), { message: 'REPOSITORY_CHANGED' });
  await assert.rejects(assertRepositoryIdentity([root], {
    ...filesystem, capture: async () => { throw new Error('REPOSITORY_NOT_FOUND'); },
  }), { message: 'REPOSITORY_NOT_FOUND' });
});

test('cancelled or oversized results cannot be returned as successful reads', () => {
  assert.throws(() => validateRepositoryReadOutput({}, 0), { message: 'DEADLINE_EXCEEDED' });
  assert.throws(() => validateRepositoryReadOutput({ text: '€'.repeat(30_000) }, 100), { message: 'OUTPUT_LIMIT' });
  assert.deepEqual(validateRepositoryReadOutput({ ready: true }, 100), { ready: true });
});
