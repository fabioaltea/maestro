import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createCodexInvocation } from '../../src/providers/codex/argv.js';
import { launchConfinedProvider } from '../../src/platform/macos/discovery/provider-launcher.js';

test('provider invocation cannot accept a shell command, external schema or overlapping auth/runtime', () => {
  const base = { binary: '/provider/codex', model: 'configured-model', runtime: '/private/run', authHome: '/private/auth', schema: '/private/run/result.schema.json' };
  assert.throws(() => createCodexInvocation({ ...base, model: '--search\nexec' }));
  assert.throws(() => createCodexInvocation({ ...base, binary: 'codex' }));
  assert.throws(() => createCodexInvocation({ ...base, schema: '/project/result.schema.json' }));
  assert.throws(() => createCodexInvocation({ ...base, authHome: '/private/run/auth' }));
  const invocation = createCodexInvocation(base);
  assert.ok(Object.isFrozen(invocation.env)); assert.ok(Object.isFrozen(invocation.args));
  assert.equal(invocation.env.OPENAI_API_KEY, undefined);
  assert.ok(invocation.args.includes('analytics.enabled=false'));
  assert.ok(invocation.args.includes('otel.metrics_exporter="none"'));
  assert.ok(invocation.args.includes('features.shell_snapshot=false'));
});

test('launcher refuses an oversized input before touching a binary or external resource', async () => {
  const result = await launchConfinedProvider({ binary: '/missing/codex', model: 'model', runtime: '/missing/run', authHome: '/missing/auth', schema: '/missing/run/result.schema.json' }, 'x'.repeat(2 * 1024 * 1024 + 1));
  assert.deepEqual(result, { ok: false, code: 'PROVIDER_CONTEXT_LIMIT' });
});

test('launcher refuses a wrapper without executing it or exposing diagnostics', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'maestro-discovery-launcher-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const binary = join(directory, 'untrusted'); const marker = join(directory, 'EXECUTED');
  await writeFile(binary, `#!/bin/sh\ntouch '${marker}'\n`, { mode: 0o700 });
  const result = await launchConfinedProvider({ binary, model: 'model', runtime: join(directory, 'run'), authHome: join(directory, 'auth'), schema: join(directory, 'run/result.schema.json') }, '{}');
  assert.deepEqual(result, { ok: false, code: 'PROVIDER_UNSUPPORTED' });
  await assert.rejects(readFile(marker), { code: 'ENOENT' });
});
