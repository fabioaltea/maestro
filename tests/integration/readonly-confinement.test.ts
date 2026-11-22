import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { once } from 'node:events';
import { access, readFile, readdir, rm } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createRegistryStore } from '../fixtures/registry-store.js';
import { createProjectRepositories } from '../fixtures/project-repositories.js';
import { createOwnershipLease } from '../../src/platform/macos/lease.js';
import { openStorage } from '../../src/storage/worker.js';
import { SQLiteStore } from '../../src/storage/sqlite-store.js';

const profile = fileURLToPath(new URL('../../src/platform/macos/storage/readonly.sb', import.meta.url));
const execute = promisify(execFile);
async function line(lines: ReturnType<typeof createInterface>): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([once(lines, 'line').then(([value]) => value as string), new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('owned readonly policy probe timed out')), 2_000);
  })]); } finally { clearTimeout(timer); }
}

test('native SQLite cannot create a WAL during a writer-close race; Node and native file writes are denied', async t => {
  const f = await createRegistryStore(t);
  const marker = join(f.directory, 'forbidden.sqlite');
  const child = spawn('/usr/bin/sandbox-exec', ['-D', `EXECUTABLE=${process.execPath}`, '-f', profile, process.execPath,
    fileURLToPath(new URL('../fixtures/readonly-policy-probe.js', import.meta.url)), f.path, marker], { stdio: ['pipe', 'pipe', 'ignore'] });
  const exited = new Promise<void>(resolve => { child.once('exit', () => resolve()); child.once('error', () => resolve()); });
  const cleanup = f.context.cleanup.bind(f.context);
  f.context.cleanup = async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await exited; f.store.close(); await cleanup();
  };
  const lines = createInterface({ input: child.stdout });
  try {
    assert.deepEqual(JSON.parse(await line(lines)), { ready: true });
    f.store.close();
    const before = await readdir(f.directory);
    assert.equal(before.includes('state.sqlite-wal'), false);
    const result = line(lines);
    child.stdin.end('writer-closed\n');
    const denied = JSON.parse(await result) as { queryCode: string; nativeWriteCode: string; writeCode: string };
    await exited;
    assert.match(denied.queryCode, /^SQLITE_(CANTOPEN|READONLY)/);
    assert.match(denied.nativeWriteCode, /^SQLITE_(CANTOPEN|READONLY)/);
    assert.match(denied.writeCode, /^(EPERM|EACCES)$/);
    assert.deepEqual(await readdir(f.directory), before);
    await assert.rejects(access(marker), { code: 'ENOENT' });
    const reader = await openStorage({ path: f.path, readonly: true });
    try { assert.equal((await reader.readSnapshot())?.store.storeId, f.storeId); }
    finally { await reader.close(); }
    assert.deepEqual(await readdir(f.directory), before);
  } finally { lines.close(); child.stdin.end(); if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); await exited; }
});

test('quiescent readonly observation holds both existing leases without creating or releasing another owner lock', async t => {
  const f = await createRegistryStore(t); f.store.close();
  const before = await readdir(f.directory), database = await readFile(f.path);
  const reader = new SQLiteStore({ path: f.path, readonly: true });
  try {
    for (const scope of ['control', 'daemon'] as const) {
      assert.equal(createOwnershipLease().tryAcquire(join(f.directory, `${scope}-lease.sqlite`), scope).status, 'BUSY');
    }
    assert.equal((await reader.readSnapshot())?.store.storeId, f.storeId);
  } finally { await reader.close(); }
  assert.deepEqual(await readdir(f.directory), before); assert.deepEqual(await readFile(f.path), database);
  const lock = createOwnershipLease().tryAcquire(join(f.directory, 'daemon-lease.sqlite'), 'daemon');
  assert.equal(lock.status, 'HELD'); if (lock.status === 'HELD') lock.handle.release();
});

test('readonly port releases each observation fence and sees later durable writes without a stale immutable connection', async t => {
  const f = await createRegistryStore(t); f.store.close();
  const input = f.intent();
  const reader = await openStorage({ path: f.path, readonly: true });
  try {
    assert.equal(await reader.getProjectOperation(input.requestId), null);
    const writer = new SQLiteStore({ path: f.path });
    try { writer.acceptProjectOperation(input); }
    finally { writer.close(); }
    assert.equal((await reader.getProjectOperation(input.requestId))?.outcome, 'IN_PROGRESS');
    for (const scope of ['control', 'daemon'] as const) {
      const lock = createOwnershipLease().tryAcquire(join(f.directory, `${scope}-lease.sqlite`), scope);
      assert.equal(lock.status, 'HELD'); if (lock.status === 'HELD') lock.handle.release();
    }
  } finally { await Promise.all([reader.close(), reader.close()]); }
});

test('exact readonly policy denies real writes, fork and spawn of its own allowed executable', async t => {
  const f = await createProjectRepositories(t);
  const probe = join(f.directory, 'readonly-policy-probe');
  await execute('/usr/bin/clang', ['-Wall', '-Wextra', '-Werror', '-O2',
    fileURLToPath(new URL('../fixtures/inspection-policy-probe.c', import.meta.url)), '-o', probe]);
  const code = async (program: string, args: string[]) => {
    try { await execute(program, args, { timeout: 2_000 }); return 0; }
    catch (error) { if (error instanceof Error && 'code' in error && typeof error.code === 'number') return error.code; throw error; }
  };
  const marker = join(f.directory, 'native-write');
  for (const args of [['write', marker], ['fork'], ['spawn']]) {
    assert.equal(await code(probe, args), 10);
    if (args[0] === 'write') await rm(marker);
    assert.equal(await code('/usr/bin/sandbox-exec', ['-D', `EXECUTABLE=${probe}`, '-f', profile, probe, ...args]), 0);
  }
  await assert.rejects(access(marker), { code: 'ENOENT' });
  let connections = 0;
  const server = createServer(socket => { connections++; socket.end(); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address(); assert.ok(address && typeof address === 'object');
    const connected = once(server, 'connection');
    assert.equal(await code(probe, ['network', String(address.port)]), 10); await connected;
    assert.equal(await code('/usr/bin/sandbox-exec', ['-D', `EXECUTABLE=${probe}`, '-f', profile, probe, 'network', String(address.port)]), 0);
    assert.equal(connections, 1);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
