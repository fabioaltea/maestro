import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseRepositoryCode } from '../../src/platform/macos/git/repository-code.js';

test('code accepts only canonical Git paths, OIDs and bounded offsets', () => {
  const oid = 'a'.repeat(40);
  assert.deepEqual(parseRepositoryCode({ kind: 'blob', oid, path: 'src/a*.ts', offset: 0 }),
    { kind: 'blob', oid, path: 'src/a*.ts', offset: 0 });
  for (const path of ['', '/etc/passwd', '../a', 'a//b', 'a/./b', 'a\0b']) {
    assert.throws(() => parseRepositoryCode({ kind: 'blob', oid, path, offset: 0 }), { message: 'INVALID_REQUEST' });
  }
  assert.throws(() => parseRepositoryCode({ kind: 'tree', oid: 'HEAD', path: '', offset: 0 }), { message: 'INVALID_REQUEST' });
});
