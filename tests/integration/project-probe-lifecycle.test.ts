import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFile, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { createProjectRepositories } from '../fixtures/project-repositories.js';
import { createPlatformPaths } from '../../src/platform/macos/paths.js';
import { createProcessIdentity } from '../../src/platform/macos/process-identity.js';
import { createProbeSupervisor } from '../../src/platform/macos/git/probe-supervisor.js';
import { createDirectRepositoryInspector } from '../../src/platform/macos/git/repository-inspector.js';
import { makeDeadline, systemClock } from '../../src/ports/clock.js';
import type { ProbeOwnership } from '../../src/ports/repository.js';
import type { ManagedResource } from '../../src/ports/storage.js';

const execute = promisify(execFile);
const identity = createProcessIdentity();
const own = (): ProbeOwnership => ({ resourceId: randomUUID(), generation: randomUUID(),
  owningInstanceId: randomUUID(), policyScope: 'foundation' });
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function absent(pid: number, timeout = 2_000) {
  const until = performance.now() + timeout;
  while (performance.now() < until) {
    if (await identity.probeAbsent(pid) === 'ABSENT') return;
    await pause(20);
  }
  throw new Error('Owned process absence unverified; preserve resources instead of terminating a saved PID');
}
async function gitChild(parent: number): Promise<number> {
  const until = performance.now() + 4_000;
  while (performance.now() < until) {
    const result = await execute('/bin/ps', ['-axo', 'pid=,ppid=,comm='], { timeout: 1_000, maxBuffer: 1024 * 1024 });
    for (const row of result.stdout.split('\n')) {
      const [pid, ppid, command] = row.trim().split(/\s+/, 3);
      if (ppid === String(parent) && command && /(?:^|\/)(git|sandbox-exec)$/.test(command)) return Number(pid);
    }
    await pause(10);
  }
  throw new Error('The controlled slow Git child was never observed; not a valid crash qualification');
}
async function blockIndex(repository: string) {
  const path = join(repository, '.git', 'index');
  await rename(path, path + '.original');
  await execute('/usr/bin/mkfifo', [path]);
}

test('real owned inspection publishes a complete result only after verified worker exit', async t => {
  const f = await createProjectRepositories(t);
  const repo = await f.createRepository('supervised');
  const snapshot = await f.snapshotTree(repo);
  const paths = (await createPlatformPaths().resolveArchive(join(f.directory, 'state'), 'write'))!;
  const resources: ManagedResource[] = [];
  const cleanup = f.context.cleanup;
  f.context.cleanup = async () => {
    for (const pid of new Set(resources.flatMap(resource => resource.pid === null ? [] : [resource.pid]))) await absent(pid);
    await cleanup();
  };
  const supervisor = createProbeSupervisor({ paths, onResource: async resource => { resources.push(resource); } });
  const probe = await supervisor.start({ kind: 'CANDIDATE', path: repo }, own(),
    { deadline: makeDeadline(systemClock, 8_000) });
  const result = await probe.result;
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.value.observation.baseState, 'VALID');
  assert.equal(resources.at(-1)?.releaseState, 'RELEASED');
  assert.equal(await probe.cancel(), 'ABSENT');
  assert.deepEqual(await f.snapshotTree(repo), snapshot);
});

test('deadline interrupts a real Git process blocked on hostile index metadata without retaining it', async t => {
  const f = await createProjectRepositories(t);
  const repo = await f.createRepository('slow-index'); await blockIndex(repo);
  const snapshot = await f.snapshotTree(repo);
  const paths = (await createPlatformPaths().resolveArchive(join(f.directory, 'state'), 'write'))!;
  let workerPid: number | null = null;
  let gitPid: number | undefined;
  const cleanup = f.context.cleanup;
  f.context.cleanup = async () => {
    if (workerPid) await absent(workerPid);
    if (gitPid) await absent(gitPid);
    await cleanup();
  };
  const supervisor = createProbeSupervisor({ paths, onResource: async resource => { workerPid = resource.pid ?? workerPid; } });
  const started = performance.now();
  const probe = await supervisor.start({ kind: 'CANDIDATE', path: repo }, own(),
    { deadline: makeDeadline(systemClock, 2_500) });
  assert.ok(workerPid);
  gitPid = await gitChild(workerPid);
  const result = await probe.result;
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, 'DEADLINE_EXCEEDED');
  assert.ok(performance.now() - started <= 4_000);
  await absent(workerPid); await absent(gitPid);
  assert.deepEqual(await f.snapshotTree(repo), snapshot);
});

test('owner crash closes the lifeline and removes a real active Git descendant without PID-based cleanup', async t => {
  const f = await createProjectRepositories(t);
  const repo = await f.createRepository('owner-crash'); await blockIndex(repo);
  const snapshot = await f.snapshotTree(repo);
  const context = f.context;
  let workerPid: number | undefined;
  let gitPid: number | undefined;
  let owner: ChildProcess | undefined;
  const originalCleanup = context.cleanup;
  context.cleanup = async () => {
    if (owner && owner.exitCode === null && owner.signalCode === null && owner.connected) {
      const stopped = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Owned fixture has not exited; preserving sandbox')), 2_000);
        owner!.once('exit', () => { clearTimeout(timer); resolve(); });
      });
      owner.send({ type: 'maestro-test-shutdown' }, () => {}); await stopped;
    }
    if (workerPid) await absent(workerPid);
    if (gitPid) await absent(gitPid);
    await originalCleanup();
  };
  owner = context.spawnNode([fileURLToPath(new URL('../fixtures/project-probe-owner.js', import.meta.url)),
    repo, join(context.directory, 'state')]);
  workerPid = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Owner fixture did not attest its worker')), 3_000);
    owner!.on('message', (value: { type?: string; workerPid?: unknown }) => {
      if (value.type === 'ready' && typeof value.workerPid === 'number') { clearTimeout(timer); resolve(value.workerPid); }
    });
    owner!.once('error', reject);
  });
  gitPid = await gitChild(workerPid);
  const exited = new Promise<void>(resolve => owner!.once('exit', () => resolve()));
  // Explicit fault injection on the captured owned ChildProcess, not a saved PID.
  owner.kill('SIGKILL'); await exited;
  await absent(workerPid); await absent(gitPid);
  assert.deepEqual(await f.snapshotTree(repo), snapshot);
});

test('oversized config and changes to config or Git topology fail closed without claiming coherent evidence', async t => {
  const f = await createProjectRepositories(t);
  const large = await f.createRepository('large-config');
  await writeFile(join(large, '.git', 'config'), '[large]\nvalue=' + 'x'.repeat(1024 * 1024));
  const bounded = await createDirectRepositoryInspector().inspectCandidate(large, undefined,
    { deadline: makeDeadline(systemClock, 5_000) });
  assert.equal(bounded.ok, false);
  if (!bounded.ok) assert.equal(bounded.error.code, 'OUTPUT_LIMIT');
  const includes = await f.createRepository('included-fifo');
  const included = join(includes, 'included.cfg');
  await execute('/usr/bin/mkfifo', [included]);
  const config = join(includes, '.git', 'config');
  await writeFile(config, await readFile(config, 'utf8') + `\n[include]\npath = ${included}\n`);
  const blocked = await createDirectRepositoryInspector().inspectCandidate(includes, undefined,
    { deadline: makeDeadline(systemClock, 2_000) });
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.equal(blocked.error.code, 'INSPECTION_UNSAFE');
  for (const mode of ['config', 'topology']) {
    const repo = await f.createRepository(mode);
    const inspector = createDirectRepositoryInspector({ checkpoint: async point => {
      if (point !== 'inspection.beforeRecheck') return;
      if (mode === 'config') await f.git(repo, ['config', 'maestro.externalChange', 'changed']);
      else {
        await rename(join(repo, '.git'), join(repo, '.git.previous'));
        await f.git(repo, ['init', '--initial-branch=replaced']);
      }
    } });
    const result = await inspector.inspectCandidate(repo, undefined, { deadline: makeDeadline(systemClock, 5_000) });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, 'REPOSITORY_UNSTABLE');
  }
});
