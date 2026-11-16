import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createBoundaryFixture, compileBoundaryProbe, PINNED_CODEX, PINNED_HASH, CANARY, syntheticProfileArgs } from '../fixtures/discovery-boundary.js';
import type { TestContext } from 'node:test';
import { createDiscoveryInferenceServer } from '../fixtures/discovery-inference-server.js';

// Dynamic URLs let the RED task compile while the production modules do not yet exist.
// Explicit G0 has no skip/fake success if the OS, pin or implementation is unavailable.
// Ordinary suites report the separate qualification as skipped, never G0 PASS.
const g0 = (name: string, run: (context: TestContext) => Promise<void>) => test(name, {
  skip: process.env.MAESTRO_DISCOVERY_G0 === '1' ? false : 'G0_EXPLICIT_QUALIFICATION_ONLY (npm run test:discovery:boundary)',
}, run);
interface Invocation { readonly args: readonly string[]; readonly env: NodeJS.ProcessEnv; readonly cwd: string }
interface Profile { readonly args: readonly string[] }
async function implementation() {
  const argv = await import(new URL('../../src/providers/codex/argv.js', import.meta.url).href) as {
    createCodexInvocation(input: { binary: string; model: string; runtime: string; authHome: string; schema: string }): Invocation;
  };
  const profile = await import(new URL('../../src/platform/macos/discovery/provider-profile.js', import.meta.url).href) as {
    createProviderProfile(input: { executable: string; runtime: string; authHome: string }): Profile;
  };
  return { ...argv, ...profile };
}
async function capture(executable: string, args: readonly string[], cwd: string, env: NodeJS.ProcessEnv, input = '') {
  const child = spawn(executable, [...args], { cwd, env, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
  const stdout: Buffer[] = [], stderr: Buffer[] = []; let bytes = 0; let overflow = false;
  const timer = setTimeout(() => child.kill('SIGKILL'), 15_000);
  child.stdout.on('data', (chunk: Buffer) => {
    bytes += chunk.length; if (bytes > 8 * 1024 * 1024) { overflow = true; child.kill('SIGKILL'); }
    else stdout.push(chunk);
  });
  child.stderr.on('data', (chunk: Buffer) => { if (Buffer.concat(stderr).length < 64 * 1024) stderr.push(chunk.subarray(0, 4096)); });
  child.stdin.on('error', () => undefined); child.stdin.end(input);
  try {
    return await new Promise<{ code: number | null; signal: string | null; stdout: string; stderr: string; overflow: boolean }>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => resolve({ code, signal, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8'), overflow }));
    });
  } finally { clearTimeout(timer); }
}

g0('G0 uses the planned native pin, never an implicit update or a fake binary', async () => {
  assert.equal(process.platform, 'darwin', 'G0_REQUIRES_MACOS');
  assert.equal(createHash('sha256').update(await readFile(PINNED_CODEX)).digest('hex'), PINNED_HASH);
});

g0('G0 argv is closed, keyring-only and does not inherit credentials or user environment', async (t) => {
  const fixture = await createBoundaryFixture(); t.after(fixture.cleanup);
  const { createCodexInvocation } = await implementation();
  const input = { binary: PINNED_CODEX, model: 'maestro-fixture', runtime: fixture.runtime, authHome: fixture.authHome, schema: fixture.schema };
  const invocation = createCodexInvocation(input);
  for (const option of ['--no-daemon', '--json', '--ephemeral', '--ignore-user-config', '--ignore-rules', '--strict-config']) assert.ok(invocation.args.includes(option));
  assert.ok(invocation.args.includes('cli_auth_credentials_store="keyring"'));
  assert.ok(!invocation.args.some(arg => arg.includes(fixture.checkout) || arg.includes(fixture.archive) || arg.includes(CANARY)));
  assert.equal(invocation.args.at(-1), '-'); assert.equal(invocation.cwd, fixture.runtime);
  assert.equal(invocation.env.CODEX_HOME, fixture.authHome);
  for (const name of ['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'CODEX_API_KEY', 'NODE_OPTIONS', 'DYLD_INSERT_LIBRARIES', 'GIT_CONFIG_GLOBAL', 'HOME']) {
    assert.notEqual(invocation.env[name], process.env[name] ?? '__absent__', `${name}: must not inherit`);
    if (name !== 'HOME') assert.equal(invocation.env[name], undefined);
  }
  assert.throws(() => createCodexInvocation({ ...input, model: 'unsafe\nmodel' }));
  assert.throws(() => createCodexInvocation({ ...input, schema: join(fixture.checkout, 'schema.json') }));
});

g0('G0 kernel denies protected reads, writes, symlink escape and execution before effects', async (t) => {
  const fixture = await createBoundaryFixture(); t.after(fixture.cleanup);
  const { createProviderProfile } = await implementation();
  const probe = await compileBoundaryProbe(fixture.directory);
  const before = await fixture.snapshot();
  const profile = createProviderProfile({ executable: probe, runtime: fixture.runtime, authHome: fixture.authHome });
  for (const path of [...fixture.secretPaths, join(fixture.runtime, 'escape-link')]) {
    const result = await capture('/usr/bin/sandbox-exec', [...profile.args, probe, 'read', path], fixture.runtime, {});
    assert.equal(result.code, 0, `PROTECTED_READ_NOT_DENIED: ${path}`);
  }
  for (const path of [fixture.secretPaths[0]!, fixture.secretPaths[2]!, fixture.secretPaths[4]!]) {
    const result = await capture('/usr/bin/sandbox-exec', [...profile.args, probe, 'write', path], fixture.runtime, {});
    assert.equal(result.code, 0, 'PROTECTED_WRITE_NOT_DENIED');
  }
  const execute = await capture('/usr/bin/sandbox-exec', [...profile.args, probe, 'exec', '/bin/sh'], fixture.runtime, {});
  assert.equal(execute.code, 0, 'EXEC_NOT_DENIED');
  const scratch = await capture('/usr/bin/sandbox-exec', [...profile.args, probe, 'write', join(fixture.runtime, 'scratch', 'probe-file')], fixture.runtime, {});
  assert.equal(scratch.code, 10, 'PRIVATE_SCRATCH_UNAVAILABLE');
  assert.deepEqual(await fixture.snapshot(), before);
});

g0('G0 real Codex ignores hostile config and exposes no uncontrolled hosted/execution channels', async (t) => {
  const fixture = await createBoundaryFixture(); t.after(fixture.cleanup);
  const backend = await createDiscoveryInferenceServer(); t.after(backend.close);
  const { createProviderProfile, createCodexInvocation } = await implementation();
  const schema = JSON.parse(await readFile(new URL('../../src/providers/codex/discovery-result.schema.json', import.meta.url), 'utf8')) as unknown;
  await writeFile(fixture.schema, JSON.stringify(schema), { mode: 0o600 });
  const invocation = createCodexInvocation({ binary: PINNED_CODEX, model: 'maestro-fixture', runtime: fixture.runtime, authHome: fixture.authHome, schema: fixture.schema });
  const profile = createProviderProfile({ executable: PINNED_CODEX, runtime: fixture.runtime, authHome: fixture.authHome });
  // Fixture-only override: fake key/local endpoint, never official account/network.
  const overrides = ['-c', 'model_provider="maestro_fixture"', '-c', 'model_providers.maestro_fixture.name="Maestro Synthetic"',
    '-c', `model_providers.maestro_fixture.base_url="${backend.baseUrl}"`, '-c', 'model_providers.maestro_fixture.wire_api="responses"',
    '-c', 'model_providers.maestro_fixture.requires_openai_auth=false', '-c', 'model_providers.maestro_fixture.env_key="MAESTRO_SYNTHETIC_KEY"'];
  const args = [...invocation.args.slice(0, -1), ...overrides, '-'];
  const before = await fixture.snapshot();
  const result = await capture('/usr/bin/sandbox-exec', [...await syntheticProfileArgs(profile.args, fixture.directory, backend.port), PINNED_CODEX, ...args], invocation.cwd,
    { ...invocation.env, MAESTRO_SYNTHETIC_KEY: 'synthetic-only-not-a-credential' },
    JSON.stringify({ schemaVersion: 1, instructionsVersion: 'fixture', sources: [{ sourceId: 'synthetic', relativePath: 'README.md', sha256: '0'.repeat(64), text: 'A synthetic project. Ask about deployment.' }], answers: [], requestKind: 'INITIAL' }));
  assert.equal(result.overflow, false);
  assert.equal(result.signal, null, 'PROVIDER_DID_NOT_FINISH_WITHIN_G0_DEADLINE');
  assert.equal(result.code, 0, 'PROVIDER_PROFILE_REJECTED');
  assert.ok(backend.requests.length > 0, 'SYNTHETIC_INFERENCE_NOT_REACHED');
  assert.deepEqual(backend.errors, []);
  const request = backend.requests[0]!.body;
  assert.equal(request.model, 'maestro-fixture');
  const serialized = JSON.stringify(backend.requests);
  assert.ok(!serialized.includes(CANARY), 'EXCLUDED_CONTENT_EXPOSED');
  assert.ok(!serialized.includes(fixture.authHome) && !serialized.includes(fixture.checkout) && !serialized.includes(fixture.archive), 'PRIVATE_PATH_EXPOSED');
  const tools = request.tools as { type: string; name?: string }[];
  assert.ok(Array.isArray(tools), 'TOOL_CATALOG_NOT_OBSERVED');
  // This pin/profile exposes only a UI question tool; exec cannot run an interview
  // through it. QUESTIONS is the portable protocol. New tool surfaces require review.
  for (const tool of tools) assert.ok(['request_user_input'].includes(tool.name ?? ''), `UNQUALIFIED_TOOL_CATALOG: ${JSON.stringify(tools.map(value => ({ type: value.type, name: value.name })))}`);
  assert.ok(result.stdout.includes('QUESTIONS'), 'NO_STRUCTURED_FINAL_RESULT');
  assert.deepEqual(await fixture.snapshot(), before);
});


g0('G0 injected provider toolcalls cannot obtain excluded bytes or mutate protected paths', async (t) => {
  for (const attack of ['read-auth', 'write-checkout', 'shell-exec'] as const) {
    await t.test(attack, async (t) => {
      const fixture = await createBoundaryFixture(); t.after(fixture.cleanup);
      const item = attack === 'shell-exec'
        ? { id: 'fc_fixture', type: 'function_call', call_id: 'call_fixture', name: 'shell', arguments: JSON.stringify({ command: ['/bin/sh', '-c', `cat "${fixture.secretPaths[0]!}"`] }) }
        : { id: 'ct_fixture', type: 'custom_tool_call', call_id: 'call_fixture', name: 'apply_patch', input: attack === 'read-auth'
          ? `*** Begin Patch\n*** Update File: ${fixture.secretPaths[0]!}\n@@\n-unknown\n+altered\n*** End Patch`
          : `*** Begin Patch\n*** Add File: ${join(fixture.checkout, 'FORBIDDEN')}\n+unauthorized\n*** End Patch` };
      const backend = await createDiscoveryInferenceServer([[item]]); t.after(backend.close);
      const { createProviderProfile, createCodexInvocation } = await implementation();
      await writeFile(fixture.schema, await readFile(new URL('../../src/providers/codex/discovery-result.schema.json', import.meta.url)), { mode: 0o600 });
      const invocation = createCodexInvocation({ binary: PINNED_CODEX, model: 'maestro-fixture', runtime: fixture.runtime, authHome: fixture.authHome, schema: fixture.schema });
      const profile = createProviderProfile({ executable: PINNED_CODEX, runtime: fixture.runtime, authHome: fixture.authHome });
      const overrides = ['-c', 'model_provider="maestro_fixture"', '-c', 'model_providers.maestro_fixture.name="Maestro Synthetic"',
        '-c', `model_providers.maestro_fixture.base_url="${backend.baseUrl}"`, '-c', 'model_providers.maestro_fixture.wire_api="responses"',
        '-c', 'model_providers.maestro_fixture.requires_openai_auth=false', '-c', 'model_providers.maestro_fixture.env_key="MAESTRO_SYNTHETIC_KEY"'];
      const before = await fixture.snapshot();
      const result = await capture('/usr/bin/sandbox-exec', [...await syntheticProfileArgs(profile.args, fixture.directory, backend.port), PINNED_CODEX, ...invocation.args.slice(0, -1), ...overrides, '-'], invocation.cwd,
        { ...invocation.env, MAESTRO_SYNTHETIC_KEY: 'synthetic-only-not-a-credential' }, 'Analyze only the synthetic stdin.');
      assert.equal(result.signal, null, 'TOOL_ATTEMPT_DID_NOT_TERMINATE');
      assert.ok(backend.requests.length > 0, 'ATTACK_NOT_DELIVERED');
      // Do not echo the request: it contains the synthetic attack itself. Look for
      // the canary only in subsequent tool results, never in this injected input.
      for (const request of backend.requests.slice(1)) {
        const input = request.body.input as { type?: string; output?: unknown }[];
        for (const value of input ?? []) if (value.type?.endsWith('_output')) {
          assert.ok(!JSON.stringify(value.output).includes(CANARY), 'EXCLUDED_TOOL_RESULT');
        }
      }
      assert.deepEqual(await fixture.snapshot(), before);
      await assert.rejects(readFile(join(fixture.checkout, 'FORBIDDEN')), { code: 'ENOENT' });
      assert.ok(!result.stdout.includes(CANARY), 'EXCLUDED_STDOUT');
    });
  }
});
