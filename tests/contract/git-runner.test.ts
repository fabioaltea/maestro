import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeDeadline, systemClock, type Deadline } from '../../src/ports/clock.js';
import type { InspectionCapabilities, InspectionFailure } from '../../src/ports/repository.js';
import { createProjectRepositories } from '../fixtures/project-repositories.js';

interface Runner {
  capabilities(): Promise<InspectionCapabilities>;
  run(query: unknown, options: { cwd: string; deadline: Deadline; signal?: AbortSignal;
    maxStdoutBytes?: number; readRoots?: readonly string[] }): Promise<{
      ok: boolean; exitCode?: number; stdout?: Uint8Array; error?: InspectionFailure;
      stdoutBytes: number; stderrBytes: number;
    }>;
}
interface RunnerModule {
  createGitRunner(options?: { platform?: string }): Runner;
  buildInspectionEnvironment(source: Readonly<Record<string, string | undefined>>, home: string): Record<string, string>;
}

async function loadRunner(): Promise<RunnerModule> {
  const url = new URL('../../src/platform/macos/git/runner.js', import.meta.url);
  assert.ok(existsSync(url), 'required confined Git runner capability has not been implemented');
  return await import(url.href) as RunnerModule;
}

test('Git runner builds a fresh allowlisted environment instead of inheriting executable configuration', async () => {
  const module = await loadRunner();
  const env = module.buildInspectionEnvironment({ HOME: '/foreign', PATH: '/evil', GIT_DIR: '/foreign',
    GIT_INDEX_FILE: '/foreign', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'filter.x.process',
    GIT_CONFIG_VALUE_0: 'sentinel', GIT_TRACE: '/secret', GIT_SSH_COMMAND: 'sentinel',
    SSH_ASKPASS: 'sentinel', DYLD_INSERT_LIBRARIES: '/evil', LD_PRELOAD: '/evil', SECRET: 'sentinel' }, '/private/home');
  assert.equal(env.HOME, '/private/home');
  assert.equal(env.GIT_CONFIG_GLOBAL, '/dev/null');
  assert.equal(env.GIT_CONFIG_SYSTEM, '/dev/null');
  assert.equal(env.GIT_CONFIG_NOSYSTEM, '1');
  assert.equal(env.GIT_ALLOW_PROTOCOL, '');
  assert.equal(env.GIT_OPTIONAL_LOCKS, '0');
  assert.equal(env.GIT_NO_LAZY_FETCH, '1');
  assert.equal(env.GIT_TERMINAL_PROMPT, '0');
  for (const key of ['GIT_DIR', 'GIT_INDEX_FILE', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0',
    'GIT_CONFIG_VALUE_0', 'GIT_TRACE', 'GIT_SSH_COMMAND', 'SSH_ASKPASS', 'DYLD_INSERT_LIBRARIES', 'LD_PRELOAD', 'SECRET']) {
    assert.equal(env[key], undefined, key);
  }
  assert.notEqual(env.PATH, '/evil');
});

test('missing confinement capability fails closed without an unconfined fallback', async t => {
  const f = await createProjectRepositories(t);
  const runner = (await loadRunner()).createGitRunner({ platform: 'unsupported' });
  const capability = await runner.capabilities();
  assert.equal(capability.status, 'UNAVAILABLE');
  assert.equal(capability.confinement, 'UNAVAILABLE');
  const result = await runner.run({ kind: 'top-level' }, { cwd: f.directory, deadline: makeDeadline(systemClock, 2_000) });
  assert.equal(result.ok, false);
  assert.equal(result.error?.code, 'INSPECTION_UNAVAILABLE');
});

test('compiled runner uses the shipped profile from an external cwd and preserves the real repository', async t => {
  const f = await createProjectRepositories(t);
  const repo = await f.createRepository('read only è');
  const before = await f.snapshotTree(repo);
  const runner = (await loadRunner()).createGitRunner();
  const capabilities = await runner.capabilities();
  assert.equal(capabilities.status, 'AVAILABLE');
  assert.equal(capabilities.confinement, 'MACOS_SANDBOX');
  assert.match(capabilities.gitVersion ?? '', /^git version 2\.50\.1/);
  assert.ok(existsSync(new URL('../../src/platform/macos/git/inspection.sb', import.meta.url)));
  const result = await runner.run({ kind: 'head-symbolic' }, { cwd: repo,
    deadline: makeDeadline(systemClock, 5_000), readRoots: [repo] });
  assert.equal(result.ok, true);
  assert.equal(result.exitCode, 0);
  assert.equal(new TextDecoder().decode(result.stdout), 'refs/heads/fixture-base\n');
  assert.deepEqual(await f.snapshotTree(repo), before);
  assert.ok(fileURLToPath(new URL('.', import.meta.url)) !== repo);
});

test('runner only accepts structured read queries, never shell text or revision expressions', async t => {
  const f = await createProjectRepositories(t);
  const runner = (await loadRunner()).createGitRunner();
  const options = { cwd: f.directory, deadline: makeDeadline(systemClock, 5_000) };
  for (const query of [{ kind: 'shell', command: 'touch sentinel' },
    { kind: 'status', args: ['--exec-path=/evil'] }, { kind: 'config-file', path: 'relative' }]) {
    const result = await runner.run(query, options);
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, 'INVALID_REQUEST');
  }
  const invalidRef = await runner.run({ kind: 'local-branch', branch: 'fixture-base^{commit}' }, options);
  assert.equal(invalidRef.ok, false);
  assert.equal(invalidRef.error?.code, 'INVALID_BASE_BRANCH');
});

test('output limits and expired/aborted calls never return partial output as a successful observation', async t => {
  const f = await createProjectRepositories(t);
  const repo = await f.createRepository('bounded');
  const runner = (await loadRunner()).createGitRunner();
  const bounded = await runner.run({ kind: 'head-symbolic' }, { cwd: repo,
    deadline: makeDeadline(systemClock, 5_000), maxStdoutBytes: 1 });
  assert.equal(bounded.ok, false);
  assert.equal(bounded.error?.code, 'OUTPUT_LIMIT');
  assert.equal(bounded.stdout, undefined);
  const expired = await runner.run({ kind: 'status' }, { cwd: repo, deadline: makeDeadline(systemClock, 0) });
  assert.equal(expired.error?.code, 'DEADLINE_EXCEEDED');
  const controller = new AbortController(); controller.abort();
  const aborted = await runner.run({ kind: 'status' }, { cwd: repo,
    deadline: makeDeadline(systemClock, 5_000), signal: controller.signal });
  assert.equal(aborted.error?.code, 'INTERRUPTED');
});

test('Git nonzero exit is bounded metadata, never raw stderr in a public failure or result', async t => {
  const f = await createProjectRepositories(t);
  const runner = (await loadRunner()).createGitRunner();
  const result = await runner.run({ kind: 'head-symbolic' }, { cwd: f.directory, deadline: makeDeadline(systemClock, 5_000) });
  assert.equal(result.ok, true);
  assert.notEqual(result.exitCode, 0);
  assert.ok(!('stderr' in result));
  assert.ok(!JSON.stringify(result).includes('fatal:'));
});
