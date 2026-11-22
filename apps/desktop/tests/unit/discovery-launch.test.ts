import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDiscoveryScope, discoveryCanStart } from '../../src/renderer/state/discovery.ts';
import type { DiscoverySnapshot } from '../../src/renderer/state/discovery.ts';
test('launch scope is relative, explicit and bounded; uncertain provider or expired preview keeps sending disabled', () => {
  assert.deepEqual(parseDiscoveryScope(' README.md\n\nsrc '), ['README.md', 'src']);
  for (const text of ['', '../src', '/src', 'src\\foo', 'a/./b', 'same\nsame', Array.from({ length: 17 }, (_, i) => String(i)).join('\n')]) assert.throws(() => parseDiscoveryScope(text));
  const provider = { configuration: { revision: '1' }, check: { state: 'AVAILABLE', capabilities: { readOnlyAnalysis: true } } };
  const snapshot = { state: 'SEALED', configRevision: '1', expiresAtMs: 100 } as DiscoverySnapshot;
  assert.equal(discoveryCanStart(provider, snapshot, true, '1', 0), true);
  assert.equal(discoveryCanStart(null, snapshot, true, '1', 0), false);
  assert.equal(discoveryCanStart(provider, null, true, '1', 0), false);
  assert.equal(discoveryCanStart(provider, snapshot, false, '1', 0), false);
  assert.equal(discoveryCanStart(provider, snapshot, true, '2', 0), false);
  assert.equal(discoveryCanStart(provider, snapshot, true, '1', 100), false);
  assert.equal(discoveryCanStart({ ...provider, check: null }, snapshot, true, '1', 0), false);
});
