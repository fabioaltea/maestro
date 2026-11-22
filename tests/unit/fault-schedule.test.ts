import test from 'node:test';
import assert from 'node:assert/strict';
import { FaultSchedule, InjectedFault } from '../fixtures/fault-schedule.js';

test('fault checkpoints deterministically pause and fail at the requested occurrence', async () => {
  const schedule = new FaultSchedule([
    { point: 'after-commit', occurrence: 2, mode: 'fail' },
    { point: 'before-spawn', occurrence: 1, mode: 'pause' },
  ]);
  await schedule.checkpoint('after-commit');
  await assert.rejects(schedule.checkpoint('after-commit'), InjectedFault);
  let resumed = false;
  const waiting = schedule.checkpoint('before-spawn').then(() => { resumed = true; });
  await Promise.resolve();
  assert.equal(resumed, false);
  schedule.release('before-spawn', 1);
  await waiting;
  assert.equal(resumed, true);
  assert.deepEqual(schedule.visits, ['after-commit:1', 'after-commit:2', 'before-spawn:1']);
});
