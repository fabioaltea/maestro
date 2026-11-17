import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID, createHash } from 'node:crypto';
import type { ArchitectResult } from '../../src/domain/discovery/documents.js';
import type { DiscoveryResult } from '../../src/domain/discovery/model.js';
import type { ProviderEvent, ProviderInput, ProviderPort, CodexInspectionPort, ProviderOutputBatch } from '../../src/ports/provider.js';
import { loadContract } from '../fixtures/load-contract.js';
import { value } from '../fixtures/discovery-artifacts.js';

interface Decoder {
  feed(bytes: Uint8Array): ProviderOutputBatch;
  finish(exitCode: number | null): DiscoveryResult<ArchitectResult>;
}
const modules = async () => loadContract<{ createCodexOutputDecoder(): Decoder }>('providers/codex/parser.js', ['createCodexOutputDecoder']);
const question = { kind: 'QUESTIONS', questions: [{ text: 'Perché 🎼?', reason: 'Non è presente nel corpus.', section: 'purpose-and-features' }], sections: null };
const line = (value: unknown) => JSON.stringify(value) + '\n';
const begin = line({ type: 'thread.started', thread_id: 'opaque-cli-thread' }) + line({ type: 'turn.started' });
const message = (result: unknown) => line({ type: 'item.completed', item: { id: 'item_final', type: 'agent_message', text: JSON.stringify(result) } });
const complete = line({ type: 'turn.completed', usage: { input_tokens: 12, cached_input_tokens: 0, output_tokens: 8 } });

test('pinned JSONL is decoded across byte/UTF-8 boundaries into a portable result only after the turn and process finish', async () => {
  const { createCodexOutputDecoder } = await modules(), decoder = createCodexOutputDecoder();
  const bytes = Buffer.from(begin + message(question) + complete); const events: ProviderEvent[] = [];
  for (const byte of bytes) events.push(...value(decoder.feed(new Uint8Array([byte]))));
  const result = value(decoder.finish(0)); assert.deepEqual(result, { kind: 'QUESTIONS', questions: question.questions });
  assert.equal(events.filter(event => event.kind === 'RESULT').length, 0, 'unverified process output is not a final result event');
});
test('exit zero, partial JSON, missing turn completion, wrong event order and trailing records cannot complete Discovery', async () => {
  const { createCodexOutputDecoder } = await modules();
  for (const input of ['', begin, begin + message(question), begin + message(question) + complete.slice(0, -1),
    message(question) + complete, begin + message(question) + complete + line({ type: 'turn.started' })]) {
    const decoder = createCodexOutputDecoder(); decoder.feed(Buffer.from(input)); assert.equal(decoder.finish(0).ok, false);
  }
  const failed = createCodexOutputDecoder(); value(failed.feed(Buffer.from(begin + message(question) + complete))); assert.equal(failed.finish(1).ok, false);
});
test('unexpected tools or item types latch failure and cannot be overwritten by a later plausible answer', async () => {
  const { createCodexOutputDecoder } = await modules();
  for (const type of ['command_execution', 'file_change', 'mcp_tool_call', 'web_search', 'request_user_input', 'unknown']) {
    const decoder = createCodexOutputDecoder(); value(decoder.feed(Buffer.from(begin)));
    assert.equal(decoder.feed(Buffer.from(line({ type: 'item.completed', item: { id: 'hostile', type, text: 'not a valid execution channel' } }))).ok, false);
    assert.equal(decoder.feed(Buffer.from(message(question) + complete)).ok, false); assert.equal(decoder.finish(0).ok, false);
  }
});
test('QUESTIONS and DOCUMENT are closed, bounded and mutually exclusive; no approval field comes from an agent', async () => {
  const { createCodexOutputDecoder } = await modules();
  const sections = ['purpose-and-features', 'architecture-and-dependencies', 'conventions-and-operations'].map(id => ({ id, title: id, claims: [] }));
  const decoder = createCodexOutputDecoder(); value(decoder.feed(Buffer.from(begin + message({ kind: 'DOCUMENT', questions: null, sections }) + complete)));
  assert.deepEqual(value(decoder.finish(0)), { kind: 'DOCUMENT', sections });
  for (const invalid of [{ ...question, approved: true }, { ...question, sections }, { ...question, questions: [] },
    { ...question, questions: Array.from({ length: 21 }, () => question.questions[0]) },
    { ...question, questions: [{ ...question.questions[0], text: 'é'.repeat(2049) }] },
    { kind: 'DOCUMENT', questions: null, sections: sections.slice(1) }, { kind: 'DOCUMENT', questions: null, sections: [...sections, sections[0]] }]) {
    const bad = createCodexOutputDecoder(); bad.feed(Buffer.from(begin + message(invalid) + complete)); assert.equal(bad.finish(0).ok, false);
  }
});
test('line/run byte caps, malformed UTF-8 and duplicate final messages fail without a false completion', async () => {
  const { createCodexOutputDecoder } = await modules();
  const lineOverflow = createCodexOutputDecoder(); assert.deepEqual(lineOverflow.feed(Buffer.alloc(1024 * 1024 + 1, 0x61)), { ok: false, code: 'PROVIDER_OUTPUT_LIMIT' });
  const invalid = createCodexOutputDecoder(); assert.equal(invalid.feed(new Uint8Array([0xff])).ok, false);
  const duplicate = createCodexOutputDecoder(); duplicate.feed(Buffer.from(begin + message(question) + message(question) + complete)); assert.equal(duplicate.finish(0).ok, false);
  const runOverflow = createCodexOutputDecoder(); value(runOverflow.feed(Buffer.from(begin)));
  const progress = Buffer.from(line({ type: 'item.completed', item: { id: 'reasoning', type: 'reasoning', text: 'x'.repeat(4000) } }));
  let result: DiscoveryResult<readonly ProviderEvent[]> = { ok: true, value: [] };
  for (let bytes = 0; bytes <= 8 * 1024 * 1024 && result.ok; bytes += progress.length) result = runOverflow.feed(progress);
  assert.deepEqual(result, { ok: false, code: 'PROVIDER_OUTPUT_LIMIT' });
});
test('provider errors preserve prior progress but expose only normalized codes, including context and quota limits', async () => {
  const { createCodexOutputDecoder } = await modules();
  for (const [code, expected] of [['insufficient_quota', 'PROVIDER_QUOTA'], ['context_length_exceeded', 'PROVIDER_CONTEXT_LIMIT'], ['invalid_api_key', 'PROVIDER_AUTH_REQUIRED']]) {
    const decoder = createCodexOutputDecoder(); const progress = value(decoder.feed(Buffer.from(begin + line({ type: 'item.completed', item: { id: 'r', type: 'reasoning', text: 'Working.' } }))));
    assert.ok(progress.length); const result = decoder.feed(Buffer.from(line({ type: 'turn.failed', error: { code, message: 'SYNTHETIC_PRIVATE_DIAGNOSTIC' } })));
    assert.deepEqual(result, { ok: false, code: expected }); assert.ok(!JSON.stringify(result).includes('SYNTHETIC_PRIVATE_DIAGNOSTIC'));
    assert.equal(decoder.finish(0).ok, false);
  }
});
test('valid records preceding a malformed record in the same pipe chunk remain observable as partial output', async () => {
  const { createCodexOutputDecoder } = await modules();
  const prefix = Buffer.from(begin + line({ type: 'item.completed', item: { id: 'r', type: 'reasoning', text: 'Validated partial progress.' } }));
  for (const suffix of [new Uint8Array([0xff]), Buffer.from(line({ type: 'turn.failed', error: { code: 'insufficient_quota', message: 'PRIVATE' } }))]) {
    const decoder = createCodexOutputDecoder(), result = decoder.feed(Buffer.concat([prefix, suffix]));
    assert.equal(result.ok, false); if (result.ok) assert.fail('EXPECTED_FAILURE');
    assert.equal(result.partial?.[0]?.kind, 'PROGRESS'); assert.ok(!JSON.stringify(result).includes('PRIVATE')); assert.equal(decoder.finish(0).ok, false);
  }
});
test('adapter serializes only the approved portable input, honors a lower trusted input budget and cannot add argv/environment', async () => {
  const { createCodexAdapter } = await loadContract<{ createCodexAdapter(options: { inspection: CodexInspectionPort; maximumInputBytes?: number }): ProviderPort }>('providers/codex/adapter.js', ['createCodexAdapter']);
  const inspection: CodexInspectionPort = { inspectBinary: async () => { throw new Error('serialization has no OS effects'); }, checkLogin: async () => { throw new Error('no login'); }, prepareAuthHome: async () => { throw new Error('no configure'); } };
  const text = 'Synthetic approved source.', sha256 = createHash('sha256').update(text).digest('hex');
  const input: ProviderInput = { runId: randomUUID(), generation: randomUUID(), schemaVersion: 1, instructionsVersion: 'project-architect-v1', requestKind: 'INITIAL',
    sources: [{ sourceId: createHash('sha256').update('README.md\0' + sha256).digest('hex'), relativePath: 'README.md', sha256, text }], answers: [], priorDraft: null, correction: null };
  const adapter = createCodexAdapter({ inspection }); const payload = value(adapter.serializeInput(input)); assert.ok(payload.includes(text)); assert.ok(Buffer.byteLength(payload) <= 2 * 1024 * 1024);
  assert.equal(adapter.serializeInput({ ...input, arbitraryPrompt: 'unapproved' } as ProviderInput).ok, false);
  assert.equal(createCodexAdapter({ inspection, maximumInputBytes: 128 }).serializeInput(input).ok, false);
  assert.equal(adapter.serializeInput({ ...input, sources: [{ ...input.sources[0]!, text: 'different unapproved bytes' }] }).ok, false);
});
