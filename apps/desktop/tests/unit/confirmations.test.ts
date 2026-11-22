import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Confirmations, blocksMutation } from '../../src/main/confirmations.ts';
import { controlledClock } from '../fixtures/desktop.ts';
const scope = () => ({ owner: 1, frame: 2, epoch: 3, archiveHandle: randomUUID(), storeId: randomUUID() });
test('confirmation is single use, expires, binds owner/frame/archive and freezes the intent', () => {
  const clock = controlledClock(), confirmations = new Confirmations(clock.now), s = scope();
  const command = { namespace: 'daemon' as const, action: 'start', archive: '/tmp/archive' };
  const prepared = confirmations.prepare(command, s, ['Avvia servizio']);
  command.action = 'stop';
  const accepted = confirmations.consume(prepared.confirmationId, s);
  assert.equal(accepted.command.action, 'start'); assert.match(accepted.intentHash, /^[a-f0-9]{64}$/);
  assert.throws(() => confirmations.consume(prepared.confirmationId, s));
  for (const patch of [{ owner: 9 }, { frame: 5 }, { epoch: 4 }, { storeId: randomUUID() }]) {
    const next = confirmations.prepare(command, s, ['Controllo']);
    assert.throws(() => confirmations.consume(next.confirmationId, { ...s, ...patch }));
  }
  const expired = confirmations.prepare(command, s, []); clock.advance(60_001);
  assert.throws(() => confirmations.consume(expired.confirmationId, s));
});
test('unknown receipts block equivalent mutations and never hide other projects or archives', () => {
  const pending = { archivePath: '/tmp/a', namespace: 'project', action: 'update', projectId: 'project-a', phase: 'UNKNOWN', outcome: null };
  assert.equal(blocksMutation([pending], '/tmp/a', 'project', 'remove', 'project-a'), true);
  assert.equal(blocksMutation([pending], '/tmp/a', 'project', 'verify', 'project-b'), false);
  assert.equal(blocksMutation([pending], '/tmp/b', 'project', 'remove', 'project-a'), false);
  assert.equal(blocksMutation([{ ...pending, phase: 'TERMINAL' }], '/tmp/a', 'project', 'remove', 'project-a'), false);
  assert.equal(blocksMutation([{ ...pending, action: 'register', projectId: null }], '/tmp/a', 'project', 'register'), true);
  assert.equal(blocksMutation([{ ...pending, namespace: 'foundation' }], '/tmp/a', 'foundation', 'stop'), true);
});
