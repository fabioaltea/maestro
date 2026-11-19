import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseFeaturePlanningResult, FEATURE_PLANNING_CAPABILITIES } from '../../src/providers/codex/feature-planning-parser.js';
import { featureDraft } from '../fixtures/feature-boundary.js';

test('feature result is bounded closed data: neither an approval nor a command can be supplied by the agent', () => {
  const draft = featureDraft();
  assert.equal(parseFeaturePlanningResult({ kind: 'DRAFT', bundle: draft }).kind, 'DRAFT');
  for (const value of [ { kind: 'DRAFT', bundle: draft, approved: true }, { kind: 'DRAFT', bundle: { ...draft, approved: true } },
    { kind: 'DRAFT', bundle: { ...draft, implementationPlan: { ...draft.implementationPlan, command: 'touch /outside' } } },
    { kind: 'DRAFT', bundle: { ...draft, request: 'x'.repeat(16 * 1024 + 1) } },
    { kind: 'QUESTIONS', questions: [] }, { kind: 'QUESTIONS', questions: Array(21).fill({ questionId: 'q', text: 'why?', reason: 'context' }) },
    { kind: 'QUESTIONS', questions: [{ questionId: 'q', text: 'why?', reason: 'context', tool: 'shell' }] },
  ]) assert.throws(() => parseFeaturePlanningResult(value));
});
test('feature parser never upgrades source provenance or unknown/provider capabilities', () => {
  const draft = featureDraft();
  for (const kind of ['CODE', 'USER_CONFIRMED']) assert.throws(() => parseFeaturePlanningResult({ kind: 'DRAFT', bundle: { ...draft,
    provenance: [{ kind, text: 'unverified', sourceId: 'forged', answerId: null }] } }));
  assert.deepEqual(FEATURE_PLANNING_CAPABILITIES, { readonlyPlanning: false, qualified: false });
  assert.equal(parseFeaturePlanningResult({ kind: 'QUESTIONS', questions: [{ questionId: 'Q1', text: 'Which audience?', reason: 'Not in the approved context' }] }).kind, 'QUESTIONS');
});
test('parsing feature output has no project or OS effects', async () => {
  const path = new URL('../fixtures/feature-boundary.js', import.meta.url), before = await readFile(path);
  parseFeaturePlanningResult({ kind: 'DRAFT', bundle: featureDraft() });
  assert.deepEqual(await readFile(path), before);
  const source = await readFile(new URL('../../src/providers/codex/feature-planning-parser.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /node:(fs|child_process|net|http)|eval\(|new Function/);
});
