import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { METHODS } from '../../src/shared/bridge-contract.ts';
import { validateRequest, validateSender } from '../../src/shared/validation.ts';
import { buildCliArgs, decodeResult } from '../../src/main/core-cli.ts';
import type { CliCommand } from '../../src/main/ports.ts';
import { discoveryDesktopFixture } from '../fixtures/discovery.ts';

const envelope = () => ({ bridgeVersion: 1, callId: randomUUID(), selectionEpoch: 1 });
test('Discovery uses named closed bridge methods and rejects raw paths, argv, credentials and confirmation flags', () => {
  for (const method of ['chooseProviderBinary', 'getDiscoveryProvider', 'checkDiscoveryProvider', 'prepareDiscoveryAction', 'confirmDiscoveryAction', 'cancelDiscoveryAction',
    'listDiscoveries', 'getDiscovery', 'getDiscoveryPreview', 'getDiscoveryOutput', 'getDiscoveryQuestions', 'getDiscoveryDocument', 'getDiscoveryEligibility', 'getDiscoveryOperation']) assert.ok((METHODS as readonly string[]).includes(method));
  const request = { ...envelope(), action: 'discovery.start', params: { projectId: randomUUID(), snapshotId: randomUUID(), expectedConfigRevision: '1', expectedProviderRevision: '1', contextDigest: 'a'.repeat(64) } };
  assert.doesNotThrow(() => validateRequest('prepareDiscoveryAction', request));
  for (const extra of [{ approved: true }, { command: 'exec' }, { path: '/private/repository' }, { apiKey: 'SYNTHETIC_ONLY' }]) assert.throws(() => validateRequest('prepareDiscoveryAction', { ...request, params: { ...request.params, ...extra } }));
  assert.throws(() => validateRequest('chooseProviderBinary', { ...envelope(), path: '/private/native' }));
  assert.throws(() => validateRequest('prepareDiscoveryAction', { ...request, action: 'discovery.configure', params: { binaryRealpath: '/private/native', modelId: 'model', expectedProviderRevision: null } }));
  assert.throws(() => validateRequest('prepareDiscoveryAction', { ...request, action: 'discovery.preview', params: { projectId: randomUUID(), expectedConfigRevision: '1', selectors: Array.from({ length: 17 }, (_, i) => `file-${i}`) } }));
  assert.throws(() => validateRequest('prepareDiscoveryAction', { ...request, params: { ...request.params, ignored: 'x'.repeat(32768) } }));
});
test('sender, main-frame and exact origin checks apply independently to the new methods', () => {
  const owner = { webContentsId: 7, frameId: 4 }, sender = { ...owner, mainFrame: true, url: 'maestro://app/index.html' };
  assert.doesNotThrow(() => validateRequest('getDiscoveryProvider', envelope()));
  for (const patch of [{ webContentsId: 8 }, { frameId: 8 }, { mainFrame: false }, { url: 'maestro://app.evil/' }, { url: 'https://example.invalid/' }]) assert.throws(() => validateSender({ ...sender, ...patch }, owner));
});
test('a provider picker returns an opaque owner/epoch-bound handle and keeps its path out of renderer data', async () => {
  const f = await discoveryDesktopFixture();
  try {
    const selected = await f.actions.chooseProviderBinary(); assert.ok(selected); assert.ok(!JSON.stringify(selected).includes(f.directory));
    const configured = await f.actions.resolve('discovery.configure', { providerBinaryHandle: selected.providerBinaryHandle, modelId: 'fixture-model', expectedProviderRevision: '1' });
    assert.equal(configured.command.namespace as string, 'discovery'); assert.equal(configured.command.action, 'provider.configure');
    assert.equal(configured.command.params?.binaryRealpath, f.binary); assert.ok(!JSON.stringify(configured.summary).includes(f.binary));
    await assert.rejects(() => f.actions.resolve('discovery.configure', { providerBinaryHandle: selected.providerBinaryHandle, modelId: 'fixture-model', expectedProviderRevision: '1', binaryRealpath: '/unapproved' }));
    f.owner.frame++; await assert.rejects(() => f.actions.resolve('discovery.configure', { providerBinaryHandle: selected.providerBinaryHandle, modelId: 'fixture-model', expectedProviderRevision: '1' }));
    f.owner.frame--; f.clock.advance(300001); await assert.rejects(() => f.actions.resolve('discovery.configure', { providerBinaryHandle: selected.providerBinaryHandle, modelId: 'fixture-model', expectedProviderRevision: '1' }));
    const current = await f.actions.chooseProviderBinary(); assert.ok(current); await f.context.select(join(f.directory, 'other'));
    await assert.rejects(() => f.actions.resolve('discovery.configure', { providerBinaryHandle: current.providerBinaryHandle, modelId: 'fixture-model', expectedProviderRevision: '1' }));
  } finally { await f.cleanup(); }
});
test('Discovery CLI stays in its namespace and its decoder rejects private provider/process payloads', () => {
  const requestId = randomUUID(), c = { namespace: 'discovery', action: 'start', archive: '/owned/archive', requestId,
    params: { projectId: randomUUID(), grantId: randomUUID() } } as unknown as CliCommand;
  const args = buildCliArgs(c); assert.equal(args[0], 'discovery'); assert.equal(args[1], 'start'); assert.ok(args.includes(requestId));
  const result = { protocolVersion: 1, storeId: randomUUID(), instanceId: randomUUID(), requestId, result: 'OK', outcome: null,
    freshness: 'LIVE', liveness: 'LIVE_VERIFIED', data: { accepted: true, requestId }, error: null };
  assert.equal(decodeResult(JSON.stringify(result), c).data.accepted, true);
  for (const extra of [{ canonicalIntent: 'PRIVATE' }, { credentialRef: '/private/key' }, { stderr: 'PRIVATE' }, { approved: true }]) assert.throws(() => decodeResult(JSON.stringify({ ...result, data: { ...result.data, ...extra } }), c));
});
