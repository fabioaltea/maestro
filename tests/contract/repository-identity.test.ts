import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chmod, mkdir, rename, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FilesystemAnchor, FilesystemIdentity } from '../../src/ports/repository.js';
import { createProjectRepositories } from '../fixtures/project-repositories.js';

async function loadIdentity(): Promise<FilesystemIdentity> {
  const url = new URL('../../src/platform/macos/git/filesystem-identity.js', import.meta.url);
  assert.ok(existsSync(url), 'required filesystem identity evidence adapter has not been implemented');
  const module = await import(url.href) as { createFilesystemIdentity(): FilesystemIdentity };
  return module.createFilesystemIdentity();
}

test('canonical APFS anchors preserve Unicode, spaces and newlines without trimming and match symlink aliases', async t => {
  const f = await createProjectRepositories(t);
  const path = join(f.directory, ' directory è\n ');
  await mkdir(path);
  await symlink(path, join(f.directory, 'alias'));
  const identity = await loadIdentity();
  const anchor = await identity.capture(path, 'directory');
  const alias = await identity.capture(join(f.directory, 'alias'), 'directory');
  assert.equal(anchor.canonicalPath, path);
  assert.equal(anchor.version, 1);
  for (const value of [anchor.device, anchor.inode, anchor.birthtimeNs]) assert.match(value, /^[0-9]+$/);
  assert.ok(BigInt(anchor.inode) > 0n);
  assert.ok(BigInt(anchor.birthtimeNs) > 0n);
  assert.equal(identity.compare(anchor, alias), 'VERIFIED');
});

test('common repository and per-worktree admin/root evidence are distinct and do not follow remote or HEAD', async t => {
  const f = await createProjectRepositories(t);
  const repo = await f.createRepository('main');
  const worktree = await f.addWorktree(repo, 'linked');
  const identity = await loadIdentity();
  const common = (await f.git(worktree, ['rev-parse', '--path-format=absolute', '--git-common-dir'])).slice(0, -1);
  const admin = (await f.git(worktree, ['rev-parse', '--absolute-git-dir'])).slice(0, -1);
  const shared = await identity.capture(common, 'directory');
  assert.equal(identity.compare(shared, await identity.capture(join(repo, '.git'), 'directory')), 'VERIFIED');
  assert.equal(identity.compare(shared, await identity.capture(admin, 'directory')), 'UNKNOWN');
  const root = await identity.capture(repo, 'directory');
  assert.equal(identity.compare(root, await identity.capture(worktree, 'directory')), 'UNKNOWN');
  await f.git(repo, ['checkout', '-b', 'different-head']);
  assert.equal(identity.compare(root, await identity.capture(repo, 'directory')), 'VERIFIED');
});

test('same path replacement and moved paths never become verified rebindings', async t => {
  const f = await createProjectRepositories(t);
  const path = join(f.directory, 'original');
  await mkdir(path);
  const identity = await loadIdentity();
  const previous = await identity.capture(path, 'directory');
  await rename(path, path + '-moved');
  await mkdir(path);
  assert.equal(identity.compare(previous, await identity.capture(path, 'directory')), 'UNKNOWN');
  assert.equal(identity.compare(previous, await identity.capture(path + '-moved', 'directory')), 'UNKNOWN');
  assert.equal(identity.compare(previous, { ...previous, version: 2 } as unknown as FilesystemAnchor), 'UNKNOWN');
  assert.equal(identity.compare(previous, { ...previous, birthtimeNs: '0' }), 'UNKNOWN');
});

test('missing, unreadable, invalid and wrong-kind evidence returns safe errors rather than raw filesystem paths', async t => {
  const f = await createProjectRepositories(t);
  const identity = await loadIdentity();
  await assert.rejects(identity.capture(join(f.directory, 'missing'), 'directory'), /^Error: REPOSITORY_NOT_FOUND$/);
  await assert.rejects(identity.capture('relative', 'directory'), /^Error: INVALID_REQUEST$/);
  const file = join(f.directory, 'file');
  await writeFile(file, 'fixture');
  await assert.rejects(identity.capture(file, 'directory'), /^Error: REPOSITORY_UNSUPPORTED$/);
  const privatePath = join(f.directory, 'unreadable');
  await mkdir(privatePath, { mode: 0o700 });
  await writeFile(join(privatePath, 'inside'), 'fixture');
  await chmod(privatePath, 0);
  try {
    await assert.rejects(identity.capture(join(privatePath, 'inside'), 'file'), /^Error: PATH_ACCESS_DENIED$/);
  } finally { await chmod(privatePath, 0o700); }
});
