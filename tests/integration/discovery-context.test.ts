import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, writeFile, appendFile, rename, symlink, link } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createProjectRepositories } from '../fixtures/project-repositories.js';
import { contextAdapter, contextOptions, contextRequest } from '../fixtures/discovery-context.js';
import { value } from '../fixtures/discovery-artifacts.js';

test('confined capture seals tracked/untracked UTF-8, relative sources and exact hashes without changing the repository', async t => {
  const f = await createProjectRepositories(t), repo = await f.createRepository('source');
  await mkdir(join(repo, 'src')); await writeFile(join(repo, 'src/main.ts'), 'const label = "Maestro 🎼";\n');
  const before = await f.snapshotTree(repo), context = await contextAdapter(), request = contextRequest(repo);
  const captured = value(await context.capture(request, contextOptions()));
  assert.deepEqual(captured.manifest.sources.map(source => source.relativePath).sort(), ['src/main.ts', 'tracked.txt']);
  assert.equal(captured.manifest.headKind, 'BRANCH'); assert.equal(captured.manifest.configRevision, '1');
  assert.equal(captured.manifest.sources.find(source => source.relativePath === 'src/main.ts')?.byteLength, Buffer.byteLength('const label = "Maestro 🎼";\n'));
  assert.equal(Buffer.from(captured.corpus).includes(Buffer.from(repo)), false);
  assert.deepEqual(await f.snapshotTree(repo), before);
  assert.equal(value(await context.revalidate(request, captured.manifest, contextOptions())).freshness, 'CURRENT');
});
test('ignored files and credential/build paths are denied explicitly and omitted before reading directory selections', async t => {
  const f = await createProjectRepositories(t), repo = await f.createRepository('excluded');
  await writeFile(join(repo, '.gitignore'), 'ignored-secret.txt\n'); await writeFile(join(repo, 'ignored-secret.txt'), 'DO_NOT_READ');
  const forbidden = ['.env', '.env.example', '.npmrc', 'id_rsa', 'private.pem', '.ssh/key', '.aws/credentials', '.codex/auth.json', '.claude/settings.json', 'node_modules/dependency.ts', 'dist/build.js'];
  for (const path of forbidden) { const parent = path.includes('/') ? join(repo, path.slice(0, path.lastIndexOf('/'))) : repo; await mkdir(parent, { recursive: true }); await writeFile(join(repo, path), 'DO_NOT_READ'); }
  const context = await contextAdapter();
  for (const path of [...forbidden, 'ignored-secret.txt', '.git/config']) assert.deepEqual(await context.capture(contextRequest(repo, [path]), contextOptions()), { ok: false, code: 'SOURCE_EXCLUDED' }, path);
  const captured = value(await context.capture(contextRequest(repo), contextOptions()));
  assert.equal(Buffer.from(captured.corpus).includes(Buffer.from('DO_NOT_READ')), false); assert.ok(captured.omissions.length > 0);
});
test('opaque archive/runtime/auth roots inside the checkout are excluded and cannot invalidate their own context', async t => {
  const f = await createProjectRepositories(t), repo = await f.createRepository('inside'); const roots = ['opaque-a', 'opaque-b', 'opaque-c'].map(name => join(repo, name));
  for (const root of roots) { await mkdir(root); await writeFile(join(root, 'state.txt'), 'MAESTRO_PRIVATE'); }
  const context = await contextAdapter(), request = contextRequest(repo, ['.'], roots);
  const captured = value(await context.capture(request, contextOptions()));
  assert.equal(Buffer.from(captured.corpus).includes(Buffer.from('MAESTRO_PRIVATE')), false);
  for (let i = 0; i < roots.length; i++) {
    assert.deepEqual(await context.capture(contextRequest(repo, [`opaque-${String.fromCharCode(97 + i)}/state.txt`], roots), contextOptions()), { ok: false, code: 'SOURCE_EXCLUDED' });
    await writeFile(join(roots[i]!, 'another.txt'), 'runtime changed');
  }
  assert.equal(value(await context.revalidate(request, captured.manifest, contextOptions())).freshness, 'CURRENT');
});
test('symlinks, hardlinks, FIFOs, known binaries and invalid UTF-8 are never source material', async t => {
  const f = await createProjectRepositories(t), repo = await f.createRepository('special');
  await writeFile(join(f.directory, 'outside'), 'outside canary'); await symlink(join(f.directory, 'outside'), join(repo, 'linked.ts'));
  await link(join(repo, 'tracked.txt'), join(repo, 'hard.ts'));
  await writeFile(join(repo, 'binary.png'), Buffer.from([0, 255, 1])); await writeFile(join(repo, 'invalid.ts'), Buffer.from([0xc3, 0x28]));
  await promisify(execFile)('/usr/bin/mkfifo', [join(repo, 'pipe.ts')]);
  const context = await contextAdapter();
  for (const path of ['linked.ts', 'hard.ts', 'pipe.ts', 'binary.png', 'invalid.ts']) assert.deepEqual(await context.capture(contextRequest(repo, [path]), contextOptions()), { ok: false, code: 'SOURCE_EXCLUDED' }, path);
  assert.deepEqual(await context.capture(contextRequest(repo, ['invalid.ts', 'tracked.txt']), contextOptions()), { ok: false, code: 'SOURCE_EXCLUDED' });
});
test('directory membership and source edits invalidate a seal; unrelated files do not extend explicit scope', async t => {
  const f = await createProjectRepositories(t), repo = await f.createRepository('membership'); await mkdir(join(repo, 'src')); await writeFile(join(repo, 'src/a.ts'), 'a\n');
  const context = await contextAdapter(), request = contextRequest(repo, ['src']), explicit = contextRequest(repo, ['tracked.txt']);
  const first = value(await context.capture(request, contextOptions())), fixed = value(await context.capture(explicit, contextOptions()));
  await writeFile(join(repo, 'src/b.ts'), 'b\n');
  assert.equal(value(await context.revalidate(request, first.manifest, contextOptions())).freshness, 'STALE');
  assert.equal(value(await context.revalidate(explicit, fixed.manifest, contextOptions())).freshness, 'CURRENT');
  await writeFile(join(repo, 'tracked.txt'), 'changed bytes\n');
  assert.equal(value(await context.revalidate(explicit, fixed.manifest, contextOptions())).freshness, 'STALE');
});
test('invalid selectors, file count and actual byte caps fail without a truncated corpus', async t => {
  const f = await createProjectRepositories(t), repo = await f.createRepository('limits'); const context = await contextAdapter();
  for (const selectors of [['/etc/passwd'], ['../escape'], ['src//a.ts'], ['src/../tracked.txt'], Array(17).fill('tracked.txt')]) assert.equal((await context.capture(contextRequest(repo, selectors), contextOptions())).ok, false);
  await writeFile(join(repo, 'large.ts'), 'x'.repeat(128 * 1024 + 1));
  assert.deepEqual(await context.capture(contextRequest(repo, ['large.ts']), contextOptions()), { ok: false, code: 'CONTEXT_LIMIT' });
  await mkdir(join(repo, 'many')); for (let i = 0; i < 201; i++) await writeFile(join(repo, 'many', `${i}.ts`), 'x');
  assert.deepEqual(await context.capture(contextRequest(repo, ['many']), contextOptions()), { ok: false, code: 'CONTEXT_LIMIT' });
  await mkdir(join(repo, 'total')); for (let i = 0; i < 9; i++) await writeFile(join(repo, 'total', `${i}.ts`), 'x'.repeat(128 * 1024));
  assert.deepEqual(await context.capture(contextRequest(repo, ['total']), contextOptions()), { ok: false, code: 'CONTEXT_LIMIT' });
});
test('ancestor replacement during extraction fails the seal even when the final component is a regular file', async t => {
  const f = await createProjectRepositories(t), repo = await f.createRepository('race'); await mkdir(join(repo, 'src')); await writeFile(join(repo, 'src/a.ts'), 'authorized');
  const outside = join(f.directory, 'outside-dir'); await mkdir(outside); await writeFile(join(outside, 'a.ts'), 'outside canary'); let changed = false;
  const context = await contextAdapter({ direct: true, checkpoint: async (point, path) => {
    if (point !== 'context.beforeOpen' || path !== 'src/a.ts' || changed) return; changed = true;
    await rename(join(repo, 'src'), join(repo, 'src-original')); await symlink(outside, join(repo, 'src'));
  } });
  assert.deepEqual(await context.capture(contextRequest(repo, ['src']), contextOptions()), { ok: false, code: 'CONTEXT_UNSTABLE' }); assert.equal(changed, true);
});
test('growth after open is bounded by actual bytes and cannot yield a valid truncated source', async t => {
  const f = await createProjectRepositories(t), repo = await f.createRepository('growth'); let changed = false;
  const context = await contextAdapter({ direct: true, checkpoint: async (point, path) => {
    if (point === 'context.afterOpen' && path === 'tracked.txt' && !changed) { changed = true; await appendFile(join(repo, path), 'x'.repeat(128 * 1024)); }
  } });
  const result = await context.capture(contextRequest(repo, ['tracked.txt']), contextOptions());
  assert.equal(result.ok, false); if (!result.ok) assert.ok(['CONTEXT_LIMIT', 'CONTEXT_UNSTABLE'].includes(result.code)); assert.equal(changed, true);
});
