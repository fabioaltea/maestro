import test from 'node:test';
import assert from 'node:assert/strict';
import { loadContract } from '../fixtures/load-contract.js';

interface Model {
  normalizeProjectName(value: unknown): string;
  nextProjectRevision(value: unknown): string;
  isTerminalProjectOutcome(value: unknown): boolean;
  transitionProjectOperation(from: string, to: string, outcome: string): string;
}
interface Intent {
  canonicalProjectIntent(storeId: string, action: string, params: Readonly<Record<string, unknown>>): string;
}
const model = () => loadContract<Model>('domain/projects/model.js', [
  'normalizeProjectName', 'nextProjectRevision', 'isTerminalProjectOutcome', 'transitionProjectOperation',
]);
const intent = () => loadContract<Intent>('domain/projects/intent.js', ['canonicalProjectIntent']);
const store = '25c6b95f-253b-49c4-9825-ff0abbe98f3a';
const project = '5fc02636-f95e-4ee8-9969-2a7e0c2478f0';

test('project names trim outside whitespace and count Unicode scalar values rather than UTF-16 units', async () => {
  const api = await model();
  assert.equal(api.normalizeProjectName(' \tMaestro 🎼\n'), 'Maestro 🎼');
  assert.equal(api.normalizeProjectName('🎼'.repeat(120)), '🎼'.repeat(120));
  assert.equal(api.normalizeProjectName('é e\u0301'), 'é e\u0301');
  for (const value of ['', ' \t\n', '🎼'.repeat(121), 'a\nb', 'a\tb', 'a\0b', 'a\u007fb', 'a\u0085b', '\ud800', '\udfff', 42, null]) {
    assert.throws(() => api.normalizeProjectName(value), /INVALID_NAME/);
  }
  // Names are display data: this pure validation does not enforce uniqueness.
  assert.equal(api.normalizeProjectName('Maestro'), api.normalizeProjectName('Maestro'));
});

test('canonical intent ignores object insertion order but retains store, action and explicit original fields', async () => {
  const api = await intent();
  const path = '/nonexistent/project 🎼';
  const a = api.canonicalProjectIntent(store, 'REGISTER', { path, name: ' Maestro ' });
  assert.equal(a, api.canonicalProjectIntent(store.toUpperCase(), 'REGISTER', { name: 'Maestro', path }));
  assert.notEqual(a, api.canonicalProjectIntent(store, 'REGISTER', { path }));
  assert.notEqual(a, api.canonicalProjectIntent(project, 'REGISTER', { path, name: 'Maestro' }));
  assert.notEqual(a, api.canonicalProjectIntent(store, 'REGISTER', { path, name: 'Maestro', baseBranch: 'main' }));
  assert.deepEqual(JSON.parse(a), { version: 1, scope: 'PROJECT', storeId: store, action: 'REGISTER',
    params: { path, name: 'Maestro' } });
  assert.equal(api.canonicalProjectIntent(store, 'UPDATE', { projectId: project, expectedRevision: '9007199254740993', patch: { name: 'x', baseBranch: null } }),
    api.canonicalProjectIntent(store, 'UPDATE', { patch: { baseBranch: null, name: 'x' }, expectedRevision: '9007199254740993', projectId: project }));
  assert.notEqual(api.canonicalProjectIntent(store, 'UPDATE', { projectId: project, expectedRevision: '1', patch: { name: 'x' } }),
    api.canonicalProjectIntent(store, 'UPDATE', { projectId: project, expectedRevision: '1', patch: { name: 'x', baseBranch: null } }));
});

test('intent rejects unsupported, ambiguous, oversized and malformed input before hashing', async () => {
  const api = await intent();
  for (const params of [{ path: 'relative' }, { path: '/a\0b' }, { path: '/' + '🎼'.repeat(4096) },
    { path: '/a', baseBranch: null }, { path: '/a', baseBranch: '' }, { path: '/a', baseBranch: '--all' },
    { path: '/a', baseBranch: 'refs/heads/x' }, { path: '/a', baseBranch: 'a..b' },
    { path: '/a', baseBranch: 'é'.repeat(513) }, { path: '/a', baseBranch: '\ud800' },
    { path: '/a', force: true }, { path: '/a', name: undefined }]) {
    assert.throws(() => api.canonicalProjectIntent(store, 'REGISTER', params), /INVALID_(REQUEST|NAME|BASE_BRANCH)/);
  }
  for (const params of [{ projectId: project, expectedRevision: '1', patch: {} },
    { projectId: project, expectedRevision: 1, patch: { name: 'x' } },
    { projectId: project, expectedRevision: '0', patch: { name: 'x' } },
    { projectId: project, expectedRevision: '01', patch: { name: 'x' } },
    { projectId: project, expectedRevision: '1', patch: { force: true } }]) {
    assert.throws(() => api.canonicalProjectIntent(store, 'UPDATE', params), /INVALID_REQUEST/);
  }
  assert.throws(() => api.canonicalProjectIntent(store, 'CHECKOUT', {}), /INVALID_REQUEST/);
});

test('configuration and observation revisions increment independently with exact integer bounds', async () => {
  const api = await model();
  const configRevision = '9007199254740993';
  const observationRevision = '4';
  assert.equal(api.nextProjectRevision(configRevision), '9007199254740994');
  assert.equal(api.nextProjectRevision(observationRevision), '5');
  assert.equal(configRevision, '9007199254740993');
  for (const bad of ['0', '-1', '1.0', '01', 1, '9223372036854775807']) {
    assert.throws(() => api.nextProjectRevision(bad), /INVALID_(REQUEST|REVISION)/);
  }
});

test('only IN_PROGRESS is pending for registry; BLOCKED and every terminal outcome forbid replay transitions', async () => {
  const api = await model();
  assert.equal(api.isTerminalProjectOutcome('IN_PROGRESS'), false);
  assert.equal(api.transitionProjectOperation('ACCEPTED', 'PROBING', 'IN_PROGRESS'), 'PROBING');
  for (const outcome of ['SUCCEEDED', 'FAILED', 'BLOCKED', 'INTERRUPTED']) {
    assert.equal(api.isTerminalProjectOutcome(outcome), true);
    assert.equal(api.transitionProjectOperation('ACCEPTED', 'FINALIZED', outcome), 'FINALIZED');
    assert.equal(api.transitionProjectOperation('PROBING', 'FINALIZED', outcome), 'FINALIZED');
    assert.throws(() => api.transitionProjectOperation('FINALIZED', 'PROBING', 'IN_PROGRESS'), /INVALID_TRANSITION/);
  }
  for (const args of [['PROBING', 'ACCEPTED', 'IN_PROGRESS'], ['ACCEPTED', 'FINALIZED', 'IN_PROGRESS'],
    ['ACCEPTED', 'PROBING', 'BLOCKED'], ['ACCEPTED', 'FINALIZED', 'UNKNOWN']]) {
    assert.throws(() => api.transitionProjectOperation(args[0]!, args[1]!, args[2]!), /INVALID_TRANSITION/);
  }
  assert.throws(() => api.isTerminalProjectOutcome('UNKNOWN'), /INVALID_REQUEST/);
});
