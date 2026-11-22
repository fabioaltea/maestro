import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createGitRunner, buildInspectionEnvironment } from '../../src/platform/macos/git/runner.js';
import { makeDeadline, systemClock } from '../../src/ports/clock.js';
import { createProjectRepositories } from '../fixtures/project-repositories.js';

const execute = promisify(execFile);
const profile = fileURLToPath(new URL('../../src/platform/macos/git/inspection.sb', import.meta.url));
const environment = buildInspectionEnvironment({}, '/var/empty');
async function exitCode(file: string, args: readonly string[], cwd: string): Promise<number> {
  try { await execute(file, [...args], { cwd, env: environment, encoding: 'utf8', timeout: 5_000, maxBuffer: 64 * 1024 }); return 0; }
  catch (error) {
    if (error instanceof Error && 'code' in error && typeof error.code === 'number') return error.code;
    throw error;
  }
}
function sandbox(program: string, roots: readonly string[], args: readonly string[]) {
  return ['-D', `EXECUTABLE=${program}`, '-D', `ROOT1=${roots[0]}`,
    '-D', `ROOT2=${roots[1] ?? roots[0]}`, '-D', `ROOT3=${roots[2] ?? roots[0]}`,
    '-f', profile, program, ...args];
}

test('exact shipped policy denies real persistent writes, fork and network with successful unsandboxed controls', async t => {
  const f = await createProjectRepositories(t);
  const probe = join(f.directory, 'policy-probe');
  const source = fileURLToPath(new URL('../fixtures/inspection-policy-probe.c', import.meta.url));
  assert.equal(await exitCode('/usr/bin/clang', ['-Wall', '-Wextra', '-Werror', '-O2', source, '-o', probe], f.directory), 0);
  const marker = join(f.directory, 'write-control');
  assert.equal(await exitCode(probe, ['write', marker], f.directory), 10);
  assert.equal(await readFile(marker, 'utf8'), 'executed');
  await rm(marker); // Only the control file created above, in the owned fixture.
  assert.equal(await exitCode('/usr/bin/sandbox-exec', sandbox(probe, [f.directory], ['write', marker]), f.directory), 0);
  await assert.rejects(access(marker), { code: 'ENOENT' });
  assert.equal(await exitCode(probe, ['fork'], f.directory), 10);
  assert.equal(await exitCode('/usr/bin/sandbox-exec', sandbox(probe, [f.directory], ['fork']), f.directory), 0);
  // posix_spawn of the same allowed executable must not bypass process-fork denial.
  assert.equal(await exitCode(probe, ['spawn'], f.directory), 10);
  assert.equal(await exitCode('/usr/bin/sandbox-exec', sandbox(probe, [f.directory], ['spawn']), f.directory), 0);
  let connections = 0;
  const server = createServer(socket => { connections++; socket.end(); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const control = once(server, 'connection');
  assert.equal(await exitCode(probe, ['network', String(address.port)], f.directory), 10);
  await control;
  assert.equal(connections, 1);
  assert.equal(await exitCode('/usr/bin/sandbox-exec', sandbox(probe, [f.directory], ['network', String(address.port)]), f.directory), 0);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(connections, 1, 'the sandboxed attempt made no connection');
});

test('real status cannot execute configured clean/process/fsmonitor/hooks/alias/pager/diff helpers or mutate Git', async t => {
  const f = await createProjectRepositories(t);
  const repo = await f.createRepository('hostile config è');
  const sentinel = await f.createSentinel('configured-helper');
  await writeFile(join(repo, '.gitattributes'), '*.txt filter=sentinel diff=sentinel\n');
  for (const key of ['filter.sentinel.clean', 'filter.sentinel.process', 'core.fsmonitor', 'core.pager',
    'diff.external', 'diff.sentinel.textconv', 'core.sshCommand']) await f.git(repo, ['config', key, sentinel.command]);
  await f.git(repo, ['config', 'alias.status', '!' + sentinel.command]);
  await writeFile(join(repo, '.git', 'hooks', 'post-index-change'), await readFile(sentinel.script), { mode: 0o700 });
  await f.makeDirty(repo);
  // Equal-size content forces index/working-file comparison and filter evaluation;
  // a different size can be reported dirty without invoking a clean filter at all.
  await writeFile(join(repo, 'tracked.txt'), 'diff\n');
  const before = await f.snapshotTree(repo);
  const runner = createGitRunner();
  assert.equal((await runner.capabilities()).status, 'AVAILABLE');
  const result = await runner.run({ kind: 'status' }, { cwd: repo, deadline: makeDeadline(systemClock, 5_000) });
  assert.equal(result.ok, true);
  assert.ok(result.stderrBytes > 0, 'blocked filter attempts must not be interpreted as a clean observation');
  await assert.rejects(access(sentinel.marker), { code: 'ENOENT' });
  assert.deepEqual(await f.snapshotTree(repo), before);
});

test('config replacement races and inherited GIT variables cannot execute helpers or switch the inspected repository', async t => {
  const f = await createProjectRepositories(t);
  const repo = await f.createRepository('race');
  const foreign = await f.createRepository('foreign');
  const sentinel = await f.createSentinel('race-helper');
  await writeFile(join(repo, '.gitattributes'), '*.txt filter=sentinel\n');
  await f.makeDirty(repo);
  await writeFile(join(repo, 'tracked.txt'), 'diff\n');
  const configPath = join(repo, '.git', 'config');
  const original = await readFile(configPath, 'utf8');
  const hostile = original + `\n[filter "sentinel"]\n\tprocess = ${sentinel.command}\n`;
  const runner = createGitRunner(); await runner.capabilities();
  const previous = process.env.GIT_DIR;
  process.env.GIT_DIR = join(foreign, '.git');
  let stop = false;
  const writer = (async () => {
    while (!stop) {
      await writeFile(configPath, hostile);
      await new Promise(resolve => setImmediate(resolve));
      await writeFile(configPath, original);
    }
  })();
  try {
    for (let attempt = 0; attempt < 5; attempt++) {
      const result = await runner.run({ kind: 'status' }, { cwd: repo, deadline: makeDeadline(systemClock, 5_000) });
      assert.equal(result.ok, true); // A nonzero Git exit remains unverified, not clean.
    }
  } finally {
    stop = true; await writer;
    await writeFile(configPath, original);
    if (previous === undefined) delete process.env.GIT_DIR; else process.env.GIT_DIR = previous;
  }
  const top = await runner.run({ kind: 'top-level' }, { cwd: repo, deadline: makeDeadline(systemClock, 5_000) });
  assert.ok(top.ok); assert.equal(new TextDecoder().decode(top.stdout), repo + '\n');
  await assert.rejects(access(sentinel.marker), { code: 'ENOENT' });
});

test('missing promisor objects cannot trigger lazy fetch or remote helpers', async t => {
  const f = await createProjectRepositories(t);
  const repo = await f.createRepository('partial');
  const oid = (await f.git(repo, ['rev-parse', 'HEAD'])).trim();
  let connections = 0;
  const server = createServer(socket => { connections++; socket.destroy(); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const address = server.address(); assert.ok(address && typeof address === 'object');
  await f.git(repo, ['config', 'remote.origin.url', `http://127.0.0.1:${address.port}/sentinel`]);
  await f.git(repo, ['config', 'remote.origin.promisor', 'true']);
  await f.git(repo, ['config', 'extensions.partialClone', 'origin']);
  await rm(join(repo, '.git', 'objects', oid.slice(0, 2), oid.slice(2)));
  const before = await f.snapshotTree(repo);
  const result = await createGitRunner().run({ kind: 'head-commit' }, { cwd: repo, deadline: makeDeadline(systemClock, 5_000) });
  assert.ok(result.ok); assert.notEqual(result.exitCode, 0);
  assert.equal(connections, 0);
  assert.deepEqual(await f.snapshotTree(repo), before);
});
