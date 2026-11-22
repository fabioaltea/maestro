import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { decodeHistoryPage, encodeActivityCursor } from '../../src/shared/activity-contract.ts';
const storeId = randomUUID();
const event = () => ({ protocolVersion: 1, storeId, eventId: randomUUID(), seq: '7', occurredAt: '2026-11-15T00:00:00.000Z', instanceId: null, operationId: randomUUID(), type: 'operation.completed', payload: { scope: 'project', action: 'VERIFY', outcome: 'SUCCEEDED', effect: 'OBSERVED', projectId: randomUUID() } });
test('history validates retained sequence, opaque store cursor and redacted public event payload', () => {
  const page = { records: [event()], firstAvailable: '7', highWater: '7', nextAfter: '7', truncated: false, cursor: encodeActivityCursor(storeId, '7') };
  assert.equal(decodeHistoryPage(page, storeId).records.length, 1);
  assert.throws(() => decodeHistoryPage(page, randomUUID()));
  assert.throws(() => decodeHistoryPage({ ...page, cursor: encodeActivityCursor(storeId, '9') }, storeId));
  assert.throws(() => decodeHistoryPage({ ...page, records: [{ ...event(), payload: { token: 'secret' } }] }, storeId));
  assert.throws(() => decodeHistoryPage({ ...page, records: [{ ...event(), seq: '6' }, { ...event(), seq: '8' }] }, storeId));
  assert.throws(() => decodeHistoryPage({ ...page, records: [{ ...event(), type: 'unsupported.event' }] }, storeId));
});
