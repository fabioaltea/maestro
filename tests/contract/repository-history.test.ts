import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseRepositoryHistory } from '../../src/platform/macos/git/repository-history.js';

test('history accepts only complete object IDs and bounded cursors', () => {
  const oid = 'a'.repeat(40);
  assert.deepEqual(parseRepositoryHistory({ kind: 'log', roots: [oid], offset: 50 }), { kind: 'log', roots: [oid], offset: 50 });
  for (const input of [
    { kind: 'log', roots: ['--all'], offset: 0 },
    { kind: 'log', roots: [oid], offset: -1 },
    { kind: 'log', roots: [oid], offset: 2 ** 32 },
    { kind: 'commit', roots: [oid], offset: 0, oid: 'HEAD' },
    { kind: 'open', path: '/tmp' },
  ]) assert.throws(() => parseRepositoryHistory(input), { message: 'INVALID_REQUEST' });
});
