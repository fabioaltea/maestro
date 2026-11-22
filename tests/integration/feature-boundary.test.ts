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

test('G0 feature planning uses the real pinned readonly CLI with a synthetic backend and unchanged project', {
  skip: process.env.MAESTRO_FEATURE_G0 !== '1' ? 'G0_EXPLICIT_SYNTHETIC_QUALIFICATION_ONLY' : false,
}, async t => {
  const { spawn } = await import('node:child_process');
  const { writeFile } = await import('node:fs/promises');
  const { createHash } = await import('node:crypto');
  const { createBoundaryFixture, PINNED_CODEX, PINNED_HASH, syntheticProfileArgs } = await import('../fixtures/discovery-boundary.js');
  const { createDiscoveryInferenceServer } = await import('../fixtures/discovery-inference-server.js');
  const { createCodexInvocation } = await import('../../src/providers/codex/argv.js');
  const { createProviderProfile } = await import('../../src/platform/macos/discovery/provider-profile.js');
  assert.equal(process.platform, 'darwin'); assert.equal(createHash('sha256').update(await readFile(PINNED_CODEX)).digest('hex'), PINNED_HASH);
  const f = await createBoundaryFixture(); t.after(f.cleanup);
  const result = { kind: 'DRAFT', bundle: featureDraft() };
  const backend = await createDiscoveryInferenceServer([[{ id: 'msg_feature', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(result), annotations: [] }] }]]); t.after(backend.close);
  const schema = { type: 'object', properties: { kind: { const: 'DRAFT' }, bundle: { type: 'object' } }, required: ['kind','bundle'], additionalProperties: false };
  await writeFile(f.schema, JSON.stringify(schema), { mode: 0o600 });
  const invocation = createCodexInvocation({ binary: PINNED_CODEX, model: 'maestro-fixture', runtime: f.runtime, authHome: f.authHome, schema: f.schema });
  const profile = createProviderProfile({ executable: PINNED_CODEX, runtime: f.runtime, authHome: f.authHome });
  const before = await f.snapshot();
  const overrides = ['-c','model_provider="maestro_fixture"','-c','model_providers.maestro_fixture.name="Maestro Synthetic"','-c',`model_providers.maestro_fixture.base_url="${backend.baseUrl}"`,'-c','model_providers.maestro_fixture.wire_api="responses"','-c','model_providers.maestro_fixture.requires_openai_auth=false','-c','model_providers.maestro_fixture.env_key="MAESTRO_SYNTHETIC_KEY"'];
  // Fixture-only synthetic auth/localhost endpoint. There is no production configuration seam.
  const child = spawn('/usr/bin/sandbox-exec', [...await syntheticProfileArgs(profile.args, f.directory, backend.port), PINNED_CODEX, ...invocation.args.slice(0,-1), ...overrides, '-'],
    { cwd: invocation.cwd, env: { ...invocation.env, MAESTRO_SYNTHETIC_KEY: 'synthetic-only-not-a-credential' }, stdio: ['pipe','pipe','ignore'], shell: false });
  let output = ''; let overflow = false;
  const timer = setTimeout(() => child.kill('SIGKILL'), 15_000);
  child.stdout.on('data', (bytes: Buffer) => { if (output.length + bytes.length > 8 * 1024 * 1024) { overflow = true; child.kill('SIGKILL'); } else output += bytes.toString('utf8'); });
  child.stdin.on('error', () => {}); child.stdin.end('Create a feature planning draft using only the synthetic context.');
  const code = await new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('close', resolve); }).finally(() => clearTimeout(timer));
  assert.equal(code, 0); assert.equal(overflow, false); assert.ok(backend.requests.length > 0); assert.deepEqual(backend.errors, []);
  const records = output.trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>);
  const messages = records.filter(r => r.type === 'item.completed').map(r => r.item as Record<string, unknown>).filter(item => item.type === 'agent_message');
  assert.equal(messages.length, 1); assert.deepEqual(parseFeaturePlanningResult(JSON.parse(String(messages[0]!.text))), result);
  assert.deepEqual(await f.snapshot(), before);
});
