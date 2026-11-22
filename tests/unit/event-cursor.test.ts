import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {encodeCursor, decodeCursor} from '../../src/protocol/event-cursor.js';
test('opaque cursor round-trips full SQLite seq without numeric loss and rejects malformed tokens', () => {
  const cursor = {storeId: randomUUID(), seq: '9223372036854775807'};
  assert.deepEqual(decodeCursor(encodeCursor(cursor)), cursor);
  for (const token of ['', '0', 'garbage', 'x'.repeat(257), encodeCursor(cursor) + '=', Buffer.from(JSON.stringify({...cursor, seq: '01'})).toString('base64url')]) assert.throws(() => decodeCursor(token), /INVALID_REQUEST/);
});
