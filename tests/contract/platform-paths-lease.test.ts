import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, lstat, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { OwnershipLease, PlatformPaths } from '../../src/ports/platform.js';
import { createTestContext } from '../fixtures/test-context.js';
import { loadContract } from '../fixtures/load-contract.js';

const paths = () => loadContract<{ createPlatformPaths(): PlatformPaths }>('platform/macos/paths.js', ['createPlatformPaths']);

test('read-only inspection never initializes an archive; write creates private canonical paths', async (t) => {
  const context = await createTestContext(t);
  const adapter = (await paths()).createPlatformPaths();
  const directory = join(context.directory, 'new-archive');
  assert.equal(await adapter.resolveArchive(directory, 'read'), null);
  await assert.rejects(lstat(directory), { code: 'ENOENT' });
  const archive = await adapter.resolveArchive(directory, 'write');
  assert.ok(archive);
  t.after(async () => {
    await adapter.validateOwnerAndLinks(archive.runtimeDirectory, 'directory');
    const marker = JSON.parse(await readFile(join(archive.runtimeDirectory, 'archive.json'), 'utf8')) as { directory: string };
    assert.equal(marker.directory, archive.directory);
    await rm(archive.runtimeDirectory, { recursive: true });
  });
  assert.equal((await lstat(archive.directory)).mode & 0o777, 0o700);
  assert.ok(Buffer.byteLength(archive.daemonEndpoint) < 90);
  const first = await adapter.createCredential(archive.clientKeyFile);
  assert.match(first, /^[0-9a-f]{64}$/);
  assert.equal(await adapter.createCredential(archive.clientKeyFile), first);
  assert.equal((await lstat(archive.clientKeyFile)).mode & 0o777, 0o600);
  assert.equal(await adapter.readCredential(archive.clientKeyFile), first);
  await writeFile(join(archive.runtimeDirectory, 'archive.json'), JSON.stringify({ directory: '/another/archive' }));
  await assert.rejects(adapter.resolveArchive(directory, 'read'), /ENDPOINT_COLLISION/);
  await writeFile(join(archive.runtimeDirectory, 'archive.json'), JSON.stringify({ directory: archive.directory, ownerUid: archive.ownerUid }));
});

test('sensitive symlinks, wrong permissions and unverified cleanup preserve the original files', async (t) => {
  const context = await createTestContext(t);
  const adapter = (await paths()).createPlatformPaths();
  const directory = join(context.directory, 'archive');
  await mkdir(directory, { mode: 0o700 });
  const foreign = join(context.directory, 'foreign');
  await writeFile(foreign, 'preserve', { mode: 0o600 });
  await symlink(foreign, join(directory, 'state.sqlite'));
  await assert.rejects(adapter.resolveArchive(directory, 'write'), /UNAUTHORIZED/);
  assert.equal(await readFile(foreign, 'utf8'), 'preserve');
  const info = await lstat(foreign);
  await assert.rejects(adapter.ownedCleanup(foreign, { uid: info.uid, inode: info.ino + 1 }), /UNAUTHORIZED/);
  await chmod(directory, 0o755);
  await assert.rejects(adapter.resolveArchive(directory, 'read'), /UNAUTHORIZED/);
});

test('a held lease cannot be reopened through another factory or stolen by another process', async (t) => {
  const context = await createTestContext(t);
  const { createOwnershipLease } = await loadContract<{ createOwnershipLease(): OwnershipLease }>('platform/macos/lease.js', ['createOwnershipLease']);
  const path = join(context.directory, 'daemon-lease.sqlite');
  const held = createOwnershipLease().tryAcquire(path, 'daemon');
  assert.equal(held.status, 'HELD');
  if (held.status !== 'HELD') return;
  const info = await lstat(path);
  assert.equal(createOwnershipLease().tryAcquire(path, 'daemon').status, 'BUSY');
  const url = pathToFileURL(resolve('dist/platform/macos/lease.js')).href;
  const probe = () => spawnSync(process.execPath, ['--input-type=module', '-e', `
    import {createOwnershipLease} from ${JSON.stringify(url)};
    const result=createOwnershipLease().tryAcquire(process.argv[1],'daemon');
    console.log(result.status);
    if(result.status==='HELD') result.handle.release();
  `, path], { encoding: 'utf8' });
  try { assert.equal(probe().stdout.trim(), 'BUSY'); }
  finally { held.handle.release(); }
  assert.equal(probe().stdout.trim(), 'HELD');
  assert.equal((await lstat(path)).ino, info.ino);
});
