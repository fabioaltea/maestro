import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { setupDiscovery } from '../../src/cli/codex.js';
import type { LocalClient } from '../../src/client/local-client.js';
import { CODEX_DISCOVERY_PIN } from '../../src/providers/codex/argv.js';

const storeId = randomUUID();
const signal = new AbortController().signal;
const directory = '/private/maestro';
const account = { state: 'CONNECTED' as const, binary: '/qualified/codex', version: CODEX_DISCOVERY_PIN.version };

test('initial Codex setup uses a grant for the pinned default and observes the exact availability operation', async () => {
  const grantId = randomUUID();
  let configured = false;
  let checkId: string | undefined;
  const calls: string[] = [];
  const run: LocalClient['runDiscovery'] = async (method, params, options) => {
    calls.push(method);
    assert.equal(options?.stateDirectory, directory);
    let outcome: 'SUCCEEDED' | null = null;
    let data: Record<string, unknown> = {};
    if (method === 'discovery.provider.get') data = { configuration: configured ? { revision: '1' } : null };
    else if (method === 'discovery.prepare') {
      assert.match(JSON.stringify(params), /"expectedProviderRevision":null/);
      assert.match(JSON.stringify(params), /"binaryRealpath":"\/qualified\/codex"/);
      assert.equal((params.intent as { storeId: string }).storeId, storeId);
      data = { grantId };
    } else if (method === 'discovery.provider.configure') {
      assert.deepEqual(params, { binaryRealpath: account.binary, grantId, modelId: 'gpt-6.1-sol' });
      configured = true;
    } else if (method === 'discovery.provider.check') {
      assert.equal(params.expectedProviderRevision, '1');
      assert.ok(options?.requestId);
      checkId = options.requestId;
    } else if (method === 'discovery.operation.get') {
      assert.equal(params.requestId, checkId);
      outcome = 'SUCCEEDED';
    } else assert.fail(method);
    return { protocolVersion: 1, requestId: options?.requestId ?? null, storeId, instanceId: null,
      result: 'OK', outcome, liveness: 'LIVE_VERIFIED', freshness: 'LIVE', data, error: null };
  };
  assert.deepEqual(await setupDiscovery(account, directory, storeId, signal, { runDiscovery: run }), { state: 'READY', code: null });
  assert.deepEqual(calls, ['discovery.provider.get', 'discovery.prepare', 'discovery.provider.configure', 'discovery.provider.get',
    'discovery.provider.check', 'discovery.operation.get']);
});

test('existing provider settings remain in place and a blocked analysis does not turn into a login error', async () => {
  const calls: string[] = [];
  const run: LocalClient['runDiscovery'] = async (method, params) => {
    calls.push(method);
    const blocked = method === 'discovery.operation.get';
    if (method === 'discovery.provider.check') assert.equal(params.expectedProviderRevision, '3');
    return { protocolVersion: 1, requestId: null, storeId, instanceId: null, result: blocked ? 'BLOCKED' : 'OK',
      outcome: blocked ? 'BLOCKED' : null, liveness: 'LIVE_VERIFIED', freshness: 'LIVE',
      data: blocked ? { operation: { error: { code: 'PROVIDER_UNSAFE' } } } : { configuration: { revision: '3' } }, error: null };
  };
  assert.deepEqual(await setupDiscovery(account, directory, storeId, signal, { runDiscovery: run }), { state: 'BLOCKED', code: 'PROVIDER_UNSAFE' });
  assert.deepEqual(calls, ['discovery.provider.get', 'discovery.provider.check', 'discovery.operation.get']);
});
