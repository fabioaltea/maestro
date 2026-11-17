import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { appendDiscoveryOutput } from '../../src/renderer/state/discovery.ts';
import { buildCliArgs } from '../../src/main/core-cli.ts';
import { discoveryCliInput } from '../../src/main/discovery-cli.ts';
import { validateRequest } from '../../src/shared/validation.ts';
test('session output stays within500lines/1MiB, rejects foreign runs/gaps and observes late truncation flags', () => {
  const runId = randomUUID(), empty = { text: '', lastSeq: '0', truncated: false };
  const chunk = (seq: number, text: string) => ({ runId, seq: String(seq), data: Buffer.from(text).toString('base64'), byteLength: Buffer.byteLength(text), truncated: false });
  const lines = appendDiscoveryOutput(empty, [chunk(1, 'riga\n'.repeat(600))], runId); assert.ok(lines.text.split('\n').length <= 500); assert.equal(lines.truncated, true);
  let bytes = empty;
  for (let seq = 1; seq <= 130; seq++) bytes = appendDiscoveryOutput(bytes, [chunk(seq, 'x'.repeat(8192))], runId);
  assert.ok(Buffer.byteLength(bytes.text) <= 1048576); assert.equal(bytes.truncated, true);
  const first = appendDiscoveryOutput(empty, [chunk(1, '<script>testo inerte</script>')], runId);
  assert.throws(() => appendDiscoveryOutput(first, [chunk(3, 'gap')], runId)); assert.throws(() => appendDiscoveryOutput(empty, [{ ...chunk(1, 'other'), runId: randomUUID() }], runId));
  const late = appendDiscoveryOutput(first, [{ ...chunk(1, 'ignored duplicate'), truncated: true }], runId); assert.equal(late.text, first.text); assert.equal(late.truncated, true);
});
test('answer/cancel schemas are scoped and reply text travels only on a private pipe', () => {
  const projectId = randomUUID(), discoveryId = randomUUID(), questionId = randomUUID(), requestId = randomUUID(), grantId = randomUUID();
  const params = { projectId, discoveryId, questionId, expectedStateRevision: '2', expectedQuestionRevision: '1', expectedAnswerRevision: '0', kind: 'ANSWER', text: 'PRIVATE_REPLY_CANARY' };
  const envelope = { bridgeVersion: 1, callId: randomUUID(), selectionEpoch: 1, action: 'discovery.answer', params };
  assert.doesNotThrow(() => validateRequest('prepareDiscoveryAction', envelope));
  assert.throws(() => validateRequest('prepareDiscoveryAction', { ...envelope, params: { ...params, approved: true } }));
  assert.throws(() => validateRequest('prepareDiscoveryAction', { ...envelope, params: { ...params, text: '🎼'.repeat(1025) } }));
  const command = { namespace: 'discovery' as const, action: 'answer', archive: '/owned/archive', requestId, params: { questionId, grantId, kind: 'ANSWER', text: params.text } };
  assert.ok(!JSON.stringify(buildCliArgs(command)).includes(params.text)); assert.deepEqual(JSON.parse(discoveryCliInput(command)!), { kind: 'ANSWER', text: params.text });
  assert.ok(buildCliArgs({ namespace: 'discovery', action: 'cancel', archive: '/owned/archive', requestId, params: { discoveryId, grantId } }).includes('cancel'));
});
test('correction and approval bodies stay off argv and require exact review fields', () => {
  const correction = 'SYNTHETIC_PRIVATE_CORRECTION_7c1277', requestId = randomUUID(), discoveryId = randomUUID(), grantId = randomUUID();
  const command = { namespace: 'discovery' as const, action: 'correct', archive: '/owned/archive', requestId, params: { discoveryId, grantId, correction } };
  assert.ok(!JSON.stringify(buildCliArgs(command)).includes(correction)); assert.deepEqual(JSON.parse(discoveryCliInput(command)!), { correction });
  const approve = { ...command, action: 'approve', params: { discoveryId, grantId, revisionId: randomUUID(), bundleDigest: 'b'.repeat(64), acceptedUnknownIds: ['purpose-and-features:0'] } };
  assert.ok(!JSON.stringify(buildCliArgs(approve)).includes('purpose-and-features:0')); assert.deepEqual(JSON.parse(discoveryCliInput(approve)!).acceptedUnknownIds, ['purpose-and-features:0']);
  assert.throws(() => validateRequest('prepareDiscoveryAction', { bridgeVersion: 1, callId: randomUUID(), selectionEpoch: 1, action: 'discovery.approve', params: { ...approve.params, approved: true } }));
});
