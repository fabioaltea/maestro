import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCliArgs, decodeResult, CoreCli } from '../../src/main/core-cli.ts';
import { sanitizedEnvironment, validateRuntime } from '../../src/main/runtime.ts';
import { createScratch, repositoryRoot } from '../fixtures/desktop.ts';
import { join } from 'node:path';
test('environment excludes executable injection and preserves only essentials', () => {
  const env = sanitizedEnvironment({ HOME: '/tmp/home', PATH: '/usr/bin', NODE_OPTIONS: '--import=evil', DYLD_LIBRARY_PATH: 'evil', ELECTRON_RUN_AS_NODE: '1', SECRET: 'token' });
  assert.equal(env.HOME, '/tmp/home');
  for (const key of ['NODE_OPTIONS', 'DYLD_LIBRARY_PATH', 'ELECTRON_RUN_AS_NODE', 'SECRET']) assert.equal(env[key], undefined);
});
test('argv cannot create a shell, switch namespace, or turn names into flags', () => {
  const cmd = { namespace: 'project' as const, action: 'register', archive: '/tmp/archive', requestId: 'a9c6ce58-fb68-4d1a-8e3c-dba370ba8313', params: { path: '/tmp/$(touch danger)', name: '--help' } };
  const args = buildCliArgs(cmd);
  assert.ok(args.includes('--name=--help')); assert.ok(args.includes('/tmp/$(touch danger)'));
  assert.throws(() => buildCliArgs({ ...cmd, action: 'exec' }));
  assert.throws(() => buildCliArgs({ ...cmd, archive: 'relative' }));
  assert.throws(() => buildCliArgs({ ...cmd, params: { ...cmd.params, shell: true } }));
});
test('real CLI JSON is authoritative and unsupported envelopes rejected', async () => {
  const f = await createScratch();
  try {
    const command = { namespace: 'daemon' as const, action: 'status', archive: f.archive };
    const actual = (await f.cli(['daemon', 'status'])).result;
    assert.equal(decodeResult(JSON.stringify(actual), command).liveness, 'ABSENT_VERIFIED');
    for (const patch of [{ protocolVersion: 2 }, { result: 'SUCCESS' }, { data: [] }, { error: { message: 'secret' } }]) assert.throws(() => decodeResult(JSON.stringify({ ...actual, ...patch }), command));
    assert.throws(() => decodeResult(JSON.stringify(actual) + '\n{}', command));
    const runtime = await validateRuntime(process.execPath, join(repositoryRoot, 'dist/cli/main.js'));
    const client = new CoreCli(runtime);
    assert.equal((await client.call(command)).liveness, 'ABSENT_VERIFIED');
    await assert.rejects(() => validateRuntime('node', '/tmp/missing'));
    client.close();
  } finally { await f.cleanup(); }
});
