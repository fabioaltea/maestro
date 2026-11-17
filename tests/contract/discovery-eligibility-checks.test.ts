import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createEligibilityChecks } from '../../src/core/discovery/eligibility.js';
const result = (projectId: string) => ({ projectId, eligible: true, reason: 'CURRENT_APPROVAL' as const, revisionId: randomUUID(), approvalId: randomUUID(), contextDigest: 'a'.repeat(64), checkedAt: new Date().toISOString(), freshness: 'CURRENT' as const });
test('eligibility UUIDs coalesce per project, cap four without queue, expire and never cross runtime/project boundaries', async () => {
  let now = 0, calls = 0, release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }), jobs: Promise<void>[] = [];
  const check = createEligibilityChecks({ now: () => now, job: work => { jobs.push(work()); }, check: async id => { calls++; await gate; return result(id); } });
  const ids = Array.from({ length: 5 }, () => randomUUID()), first = await check(ids[0]!);
  assert.equal((await check(ids[0]!)).checkId, first.checkId); assert.equal((await check(ids[0]!, first.checkId!)).reason, 'CHECKING'); assert.equal(calls, 1);
  for (const id of ids.slice(1, 4)) await check(id); await assert.rejects(check(ids[4]!), /DISCOVERY_BUSY/); assert.equal(calls, 4);
  await assert.rejects(check(ids[1]!, first.checkId!), /CHECK_EXPIRED/);
  const other = createEligibilityChecks({ job: work => { jobs.push(work()); }, check: async id => result(id) }); await assert.rejects(other(ids[0]!, first.checkId!), /CHECK_EXPIRED/);
  release(); await Promise.all(jobs); assert.equal((await check(ids[0]!, first.checkId!)).eligible, true); now = 30001; await assert.rejects(check(ids[0]!, first.checkId!), /CHECK_EXPIRED/);
  await check(ids[0]!); assert.equal(calls, 5); await Promise.all(jobs);
});
test('timeout and errors are false; late resolution never rewrites the result', async () => {
  const jobs: Promise<void>[] = []; let release!: () => void;
  const check = createEligibilityChecks({ timeoutMs: 5, job: work => { jobs.push(work()); }, check: async id => { await new Promise<void>(resolve => { release = resolve; }); return result(id); } });
  const id = randomUUID(), first = await check(id); await Promise.all(jobs); const timed = await check(id, first.checkId!); assert.equal(timed.eligible, false); assert.equal(timed.reason, 'UNKNOWN'); release(); await Promise.resolve(); assert.deepEqual(await check(id, first.checkId!), timed);
});
