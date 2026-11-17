import assert from 'node:assert/strict';
import test from 'node:test';
import { createCodexCapabilities, CODEX_DISCOVERY_QUALIFICATION, normalizeCodexLoginStatus } from '../../src/providers/codex/capabilities.js';
import { CODEX_DISCOVERY_PIN } from '../../src/providers/codex/argv.js';
import type { CodexInspectionPort, ProviderConfiguration } from '../../src/ports/provider.js';

const configuration: ProviderConfiguration = { providerId: 'codex', revision: '1', binaryRealpath: '/trusted/codex',
  binaryVersion: CODEX_DISCOVERY_PIN.version, binarySha256: CODEX_DISCOVERY_PIN.sha256, modelId: 'explicit-model', authProfileRef: '/private/maestro-auth',
  policyVersion: CODEX_DISCOVERY_PIN.policyVersion, qualificationDigest: CODEX_DISCOVERY_QUALIFICATION.digest, configuredAt: '2026-11-17T10:00:00.000Z' };
test('login status accepts only the pinned official mode, never API keys, diagnostics or exit zero alone', () => {
  const decode = (code: number | null, text: string) => normalizeCodexLoginStatus(code, Buffer.from(text));
  assert.equal(decode(0, 'Logged in using ChatGPT\n'), 'CHATGPT'); assert.equal(decode(1, 'Not logged in\n'), 'AUTH_REQUIRED');
  for (const text of ['', 'Logged in using API key: SYNTHETIC_KEY', 'Error checking login status: Keychain unavailable', 'Unknown mode\nLogged in using ChatGPT']) assert.equal(decode(0, text), 'UNSAFE');
  assert.equal(decode(1, 'Logged in using ChatGPT'), 'UNSAFE');
  assert.equal(normalizeCodexLoginStatus(0, new Uint8Array([0xff])), 'UNSAFE'); assert.equal(decode(0, 'x'.repeat(8193)), 'UNSAFE');
});
test('only the qualified pin/profile and an explicit model can reach the login probe', async () => {
  let probes = 0;
  const probe: CodexInspectionPort = { inspectBinary: async () => ({ ok: true, value: { version: configuration.binaryVersion, sha256: configuration.binarySha256 } }),
    checkLogin: async () => { probes++; return 'CHATGPT'; }, prepareAuthHome: async () => { throw new Error('configuration only'); } };
  const service = createCodexCapabilities(probe);
  for (const override of [{ binaryVersion: 'other' }, { binarySha256: 'a'.repeat(64) }, { policyVersion: 'other' },
    { qualificationDigest: 'a'.repeat(64) }, { modelId: '' }, { modelId: '--model=other' }, { providerId: 'other' }]) {
    assert.equal((await service.checkAvailability({ ...configuration, ...override })).state, 'UNSUPPORTED');
  }
  assert.equal(probes, 0);
  assert.equal((await service.checkAvailability(configuration)).state, 'AVAILABLE'); assert.equal(probes, 1);
});
test('official login states are normalized with fresh checkedAt and no remote capabilities invented', async () => {
  let login: Awaited<ReturnType<CodexInspectionPort['checkLogin']>> = 'AUTH_REQUIRED', calls = 0;
  const service = createCodexCapabilities({ inspectBinary: async () => { calls++; return { ok: true, value: { version: configuration.binaryVersion, sha256: configuration.binarySha256 } }; },
    checkLogin: async () => login, prepareAuthHome: async () => { throw new Error('unexpected'); } }, () => new Date('2026-11-17T11:00:00.000Z'));
  const missing = await service.checkAvailability(configuration); assert.equal(missing.code, 'PROVIDER_AUTH_REQUIRED'); assert.equal(missing.capabilities.readOnlyAnalysis, false);
  login = 'UNSAFE'; assert.equal((await service.checkAvailability(configuration)).code, 'PROVIDER_UNSAFE');
  login = 'UNAVAILABLE'; assert.equal((await service.checkAvailability(configuration)).code, 'PROVIDER_UNAVAILABLE');
  login = 'CHATGPT'; const available = await service.checkAvailability(configuration);
  assert.equal(available.checkedAt, '2026-11-17T11:00:00.000Z'); assert.equal(available.capabilities.readOnlyAnalysis, true);
  assert.equal(available.capabilities.nativeResume, false); assert.equal(available.capabilities.verifiedRemoteCancellation, false); assert.equal(available.capabilities.quotaResetInfo, false);
  assert.equal(calls, 4, 'binary is re-inspected for each availability check');
});
test('binary replacement and probe exceptions fail closed without exposing diagnostic text', async () => {
  const service = createCodexCapabilities({ inspectBinary: async () => ({ ok: true, value: { version: configuration.binaryVersion, sha256: 'd'.repeat(64) } }),
    checkLogin: async () => { throw new Error('must not reach Keychain'); }, prepareAuthHome: async () => { throw new Error('unexpected'); } });
  assert.equal((await service.checkAvailability(configuration)).code, 'PROVIDER_UNSUPPORTED');
  const unavailable = createCodexCapabilities({ inspectBinary: async () => { throw new Error('SYNTHETIC_SECRET_DIAGNOSTIC'); },
    checkLogin: async () => 'CHATGPT', prepareAuthHome: async () => { throw new Error('unexpected'); } });
  assert.ok(!JSON.stringify(await unavailable.checkAvailability(configuration)).includes('SYNTHETIC_SECRET'));
});
