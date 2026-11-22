import test from 'node:test';
import assert from 'node:assert/strict';
import { loadContract } from '../fixtures/load-contract.js';
import type { DiscoveryDocument } from '../../src/domain/discovery/documents.js';
export const draft = (): DiscoveryDocument => ({ kind: 'DOCUMENT', sections: ['purpose-and-features', 'architecture-and-dependencies', 'conventions-and-operations'].map(id => ({ id, title: id, claims: [{ kind: 'UNKNOWN', text: 'Informazione assente', sources: [], answers: [], reason: 'Non documentata' }] })) });
test('document validates required sections and explicit UNKNOWN without asserting semantic truth', async () => {
  const { validateDiscoveryDocument: validate } = await loadContract<{ validateDiscoveryDocument(d: unknown, evidence: object): { unknownIds: string[] } }>('domain/discovery/documents.js', ['validateDiscoveryDocument']);
  assert.equal(validate(draft(), { sources: [], answers: [] }).unknownIds.length, 3);
  for (const change of [() => ({ ...draft(), extra: true }), () => ({ ...draft(), sections: [] }), () => ({ ...draft(), sections: [...draft().sections, draft().sections[0]] }), () => ({ ...draft(), sections: Array(21).fill(draft().sections[0]) })]) assert.throws(() => validate(change(), { sources: [], answers: [] }));
  const d = draft(); (d.sections[0]!.claims[0]! as { reason: string | null }).reason = null; assert.throws(() => validate(d, { sources: [], answers: [] }));
});
test('CODE requires known hash and exact line range/quote; USER_CONFIRMED requires durable answer revision', async () => {
  const { validateDiscoveryDocument: validate } = await loadContract<{ validateDiscoveryDocument(d: unknown, evidence: object): unknown }>('domain/discovery/documents.js', ['validateDiscoveryDocument']);
  const source = { sourceId: 'a'.repeat(64), sha256: 'b'.repeat(64), text: 'first\nsecond\n' }, answer = { answerId: 'answer', revision: '1', kind: 'ANSWER' };
  const d = draft(), claim = d.sections[0]!.claims[0]! as unknown as Record<string, unknown>;
  Object.assign(claim, { kind: 'CODE', sources: [{ sourceId: source.sourceId, sha256: source.sha256, startLine: 1, endLine: 1, quote: 'first' }], reason: null });
  validate(d, { sources: [source], answers: [] }); assert.throws(() => validate(d, { sources: [], answers: [] }));
  (claim.sources as { quote: string }[])[0]!.quote = 'invented'; assert.throws(() => validate(d, { sources: [source], answers: [] }));
  Object.assign(claim, { kind: 'USER_CONFIRMED', sources: [], answers: [{ answerId: 'answer', revision: '1' }] });
  validate(d, { sources: [], answers: [answer] }); assert.throws(() => validate(d, { sources: [], answers: [{ ...answer, revision: '2' }] }));
  Object.assign(claim, { kind: 'HYPOTHESIS', answers: [], reason: 'Da verificare' }); validate(d, { sources: [], answers: [] });
  Object.assign(claim, { kind: 'NOT_APPLICABLE', reason: null }); assert.throws(() => validate(d, { sources: [], answers: [] }));
});
test('document limits reject 201 claims and oversized UTF-8 without truncation', async () => {
  const { validateDiscoveryDocument: validate } = await loadContract<{ validateDiscoveryDocument(d: unknown, evidence: object): unknown }>('domain/discovery/documents.js', ['validateDiscoveryDocument']);
  const d = draft(); (d.sections[0] as unknown as { claims: unknown[] }).claims = Array(201).fill(d.sections[0]!.claims[0]); assert.throws(() => validate(d, { sources: [], answers: [] }));
  const large = draft(); (large.sections[0]!.claims[0]! as { text: string }).text = 'x'.repeat(256 * 1024); assert.throws(() => validate(large, { sources: [], answers: [] }));
});
