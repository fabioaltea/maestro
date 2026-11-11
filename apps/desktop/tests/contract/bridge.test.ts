import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { validateRequest, validateSender } from '../../src/shared/validation.ts';
const base = () => ({ bridgeVersion: 1, callId: randomUUID(), selectionEpoch: 0 });
test('closed request schemas reject arbitrary privilege or input', () => {
  assert.doesNotThrow(() => validateRequest('status', base()));
  for (const method of ['exec', 'fs', 'invoke', 'getCredential']) assert.throws(() => validateRequest(method, base()));
  for (const patch of [{ command: 'rm' }, { selectionEpoch: -1 }, { bridgeVersion: 2 }, { callId: 'bad' }]) {
    assert.throws(() => validateRequest('status', { ...base(), ...patch }));
  }
  assert.throws(() => validateRequest('getProject', { ...base(), projectId: '../secret' }));
  assert.throws(() => validateRequest('listProjects', { ...base(), limit: 1000 }));
  assert.throws(() => validateRequest('status', { ...base(), extra: 'a'.repeat(32768) }));
});
test('action schemas preserve omitted versus null base and reject executable paths', () => {
  const input = { ...base(), action: 'project.update', params: { projectId: randomUUID(), expectedRevision: '3', patch: { baseBranch: null } } };
  assert.doesNotThrow(() => validateRequest('prepareAction', input));
  assert.throws(() => validateRequest('prepareAction', { ...input, params: { ...input.params, patch: {} } }));
  assert.throws(() => validateRequest('prepareAction', { ...input, params: { ...input.params, path: '/etc' } }));
  assert.throws(() => validateRequest('prepareAction', { ...base(), action: 'daemon.kill', params: {} }));
});
test('owner, main frame and exact origin required independently', () => {
  const owner = { webContentsId: 7, frameId: 4 };
  const sender = { webContentsId: 7, frameId: 4, mainFrame: true, url: 'maestro://app/index.html' };
  assert.doesNotThrow(() => validateSender(sender, owner));
  for (const patch of [{ webContentsId: 8 }, { frameId: 5 }, { mainFrame: false }, { url: 'https://example.com/' }, { url: 'maestro://app.evil/' }]) {
    assert.throws(() => validateSender({ ...sender, ...patch }, owner));
  }
});
