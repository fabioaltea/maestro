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
  await mkdir(join(repo, 'src')); await writeFile(join(repo, 'src/main.ts'), 'const label = "Maestro 🎼";\n'); await writeFile(join(repo, 'src', 'café.ts'.normalize('NFD')), 'accented source\n');
  const before = await f.snapshotTree(repo), context = await contextAdapter(), request = contextRequest(repo);
  const captured = value(await context.capture(request, contextOptions()));
  assert.deepEqual(captured.manifest.sources.map(source => source.relativePath).sort(), ['src/café.ts', 'src/main.ts', 'tracked.txt']);
  assert.equal(captured.manifest.headKind, 'BRANCH'); assert.equal(captured.manifest.configRevision, '1');
  assert.equal(captured.manifest.sources.find(source => source.relativePath === 'src/main.ts')?.byteLength, Buffer.byteLength('const label = "Maestro 🎼";\n'));
  assert.equal(Buffer.from(captured.corpus).includes(Buffer.from(repo)), false);
  assert.deepEqual(await f.snapshotTree(repo), before);
  assert.equal(value(await context.revalidate(request, captured.manifest, contextOptions())).freshness, 'CURRENT');
});
test('ignored files and credential/build paths are denied explicitly and omitted before reading directory selections', async t => {
  const f = await createProjectRepositories(t), repo = await f.createRepository('excluded');
  await writeFile(join(repo, '.gitignore'), 'ignored-secret.txt\n'); await writeFile(join(repo, 'ignored-secret.txt'), 'DO_NOT_READ');
  const forbidden = ['.env', '.env.example', '.envrc', '.ENV.LOCAL', 'credentials.yaml', 'private.ppk', '.npmrc', 'id_rsa', 'private.pem', '.ssh/key', '.aws/credentials', '.codex/auth.json', '.claude/settings.json', 'node_modules/dependency.ts', 'dist/build.js'];
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
test('a membership change after extraction prevents publication of a mixed snapshot', async t => {
  const f = await createProjectRepositories(t), repo = await f.createRepository('late-member'); let changed = false;
  const context = await contextAdapter({ checkpoint: async point => {
    if (point === 'context.beforeInventoryRecheck' && !changed) { changed = true; await writeFile(join(repo, 'late.ts'), 'late member'); }
  } });
  assert.deepEqual(await context.capture(contextRequest(repo), contextOptions()), { ok: false, code: 'CONTEXT_UNSTABLE' });
});
test('the shipped extractor OS policy prevents protected reads, writes, process creation and network', async t => {
  const { createServer } = await import('node:net');
  const { fileURLToPath } = await import('node:url');
  const { loadContract } = await import('../fixtures/load-contract.js');
  const module = await loadContract<{ contextProfileArguments(executable: string, code: string, root: string, excluded: readonly string[]): string[] }>('platform/macos/discovery/context-reader.js', ['contextProfileArguments']);
  const f = await createProjectRepositories(t), repo = await f.createRepository('policy'); const auth = join(repo, 'opaque-auth'); await mkdir(auth);
  const outside = join(f.directory, 'outside-canary'); await writeFile(outside, 'outside'); await writeFile(join(auth, 'secret'), 'auth'); await writeFile(join(repo, '.env'), 'env');
  const before = await f.snapshotTree(repo), server = createServer(socket => socket.destroy()); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('NO_OWNED_SERVER');
  const program = `import fs from 'node:fs';import {spawnSync} from 'node:child_process';import net from 'node:net';
const readDenied=[];for(const path of ${JSON.stringify([outside, join(auth, 'secret'), join(repo, '.env')])}){try{fs.readFileSync(path);readDenied.push(false)}catch(e){readDenied.push(['EPERM','EACCES'].includes(e.code))}}
let writeDenied=false;try{fs.writeFileSync(${JSON.stringify(join(repo, 'unexpected-write'))},'denied')}catch(e){writeDenied=['EPERM','EACCES'].includes(e.code)}
const child=spawnSync(process.execPath,['-e','process.exit(0)']);const processDenied=['EPERM','EACCES'].includes(child.error?.code);
const networkDenied=await new Promise(resolve=>{const socket=net.connect(${address.port},'127.0.0.1');socket.on('error',e=>resolve(['EPERM','EACCES'].includes(e.code)));socket.on('connect',()=>{socket.destroy();resolve(false)});setTimeout(()=>{socket.destroy();resolve(false)},500).unref()});
process.stdout.write(JSON.stringify({allowed:fs.readFileSync(${JSON.stringify(join(repo, 'tracked.txt'))},'utf8'),readDenied,writeDenied,processDenied,networkDenied}));`;
  const args = module.contextProfileArguments(process.execPath, fileURLToPath(new URL('../../src/', import.meta.url)).replace(/\/$/, ''), repo, [auth]);
  const result = await promisify(execFile)('/usr/bin/sandbox-exec', [...args, process.execPath, '--input-type=module', '-e', program], { cwd: '/', env: { HOME: '/var/empty', PATH: '/usr/bin:/bin', LANG: 'C' }, timeout: 5000, maxBuffer: 16384 });
  assert.deepEqual(JSON.parse(result.stdout), { allowed: 'base\n', readDenied: [true, true, true], writeDenied: true, processDenied: true, networkDenied: true });
  assert.deepEqual(await f.snapshotTree(repo), before);
});
for (const failPublication of [false, true]) {
  test(`sealed preview references both durable artifacts only after publication${failPublication ? ' failure' : ''}`, async t => {
    const { createRegistryStore } = await import('../fixtures/registry-store.js');
    const { randomUUID } = await import('node:crypto'); const Database = (await import('better-sqlite3')).default;
    const { sealDiscoveryContext } = await import('../../src/core/discovery/context.js');
    const f = await createProjectRepositories(t), repo = await f.createRepository('seal'), archive = await createRegistryStore(t);
    const projectId = randomUUID(), at = new Date().toISOString(), database = new Database(archive.path); t.after(() => database.close());
    database.prepare("INSERT INTO projects(project_id,display_name,repository_key,repository_identity,reference_checkout,base_branch,config_revision,created_at,updated_at) VALUES(?,'Seal fixture',?,'{}','{}',NULL,1,?,?)").run(projectId, 'f'.repeat(64), at, at);
    const context = await contextAdapter(), request = { ...contextRequest(repo), storeId: archive.storeId, projectId };
    let publications = 0;
    const result = await sealDiscoveryContext(request, { context, artifacts: {
      reserve: async (kind, maximum) => archive.store.reserveDiscoveryArtifact(kind, maximum),
      publish: async (id, bytes) => { publications++; return failPublication && publications === 2 ? { ok: false, code: 'PERSISTENCE_UNAVAILABLE' } : archive.store.publishDiscoveryArtifact(id, bytes); },
      read: async (id, offset, maximum) => archive.store.readDiscoveryArtifact(id, offset, maximum), reconcile: async () => archive.store.reconcileDiscoveryArtifacts(),
    }, saveSnapshot: async snapshot => archive.store.commitDiscoveryMetadata({ kind: 'snapshot', value: snapshot }) }, contextOptions());
    assert.equal(result.ok, !failPublication);
    if (result.ok) {
      assert.equal(result.value.state, 'SEALED'); assert.equal(value(archive.store.readDiscoveryMetadata({ kind: 'snapshot', id: result.value.snapshotId })).data?.contextDigest, result.value.contextDigest);
      assert.ok(value(archive.store.readDiscoveryArtifact(result.value.manifestArtifactId!, 0, 8192)).totalBytes > 0);
      assert.ok(value(archive.store.readDiscoveryArtifact(result.value.corpusArtifactId!, 0, 8192)).totalBytes > 0);
      const { inspectDiscovery } = await import('../../src/core/inspect-main.js');
      const page = await inspectDiscovery(archive.directory, 'discovery.preview.get', { snapshotId: result.value.snapshotId, sources: true });
      assert.equal(page.result, 'OK'); assert.equal(page.freshness, 'LAST_KNOWN'); assert.equal((page.data.items as { relativePath: string }[])[0]?.relativePath, 'tracked.txt');
      assert.ok(Buffer.byteLength(JSON.stringify(page)) <= 32768); assert.doesNotMatch(JSON.stringify(page), /relativeKey|manifestArtifactId|corpusArtifactId|credentialRef/);
    } else assert.equal(Number((database.prepare('SELECT count(*) AS n FROM discovery_snapshots').get() as { n: number }).n), 0);
  });
}
test('the confined extraction helper exits promptly when its private owner lifeline closes', async t => {
  const { spawn } = await import('node:child_process'); const { once } = await import('node:events'); const { fileURLToPath } = await import('node:url');
  const { loadContract } = await import('../fixtures/load-contract.js');
  const module = await loadContract<{ contextProfileArguments(executable: string, code: string, root: string, excluded: readonly string[]): string[] }>('platform/macos/discovery/context-reader.js', ['contextProfileArguments']);
  const f = await createProjectRepositories(t), repo = await f.createRepository('lifeline');
  const main = fileURLToPath(new URL('../../src/platform/macos/discovery/context-main.js', import.meta.url));
  const args = module.contextProfileArguments(process.execPath, fileURLToPath(new URL('../../src/', import.meta.url)).replace(/\/$/, ''), repo, []);
  const child = spawn('/usr/bin/sandbox-exec', [...args, process.execPath, main], { cwd: '/', env: { HOME: '/var/empty', PATH: '/usr/bin:/bin' }, stdio: ['pipe', 'pipe', 'pipe', 'pipe'] });
  const closed = once(child, 'close'); const timer = setTimeout(() => { child.kill('SIGKILL'); }, 1500);
  child.stdio[3]!.destroy();
  try { const [code, signal] = await closed; assert.equal(signal, null); assert.equal(code, 1); } finally { clearTimeout(timer); }
});
test('an explicit credential selection is refused before any repository probe or source read', async () => {
  const { createDiscoveryContext } = await import('../../src/core/discovery/context.js'); let effects = 0;
  const context = createDiscoveryContext({ inventory: { inventory: async () => { effects++; throw new Error('MUST_NOT_PROBE'); } }, extractor: { extract: async () => { effects++; throw new Error('MUST_NOT_READ'); } } });
  assert.deepEqual(await context.capture(contextRequest('/not-opened', ['.env.local']), contextOptions()), { ok: false, code: 'SOURCE_EXCLUDED' }); assert.equal(effects, 0);
});
test('replacing an ancestor with identical source bytes between passes still rejects an unstable capture', async t => {
  const f = await createProjectRepositories(t), repo = await f.createRepository('identical-race'); await mkdir(join(repo, 'src')); await writeFile(join(repo, 'src/a.ts'), 'same bytes'); let changed = false;
  const context = await contextAdapter({ checkpoint: async point => {
    if (point !== 'context.beforeInventoryRecheck' || changed) return; changed = true;
    await rename(join(repo, 'src'), join(repo, 'src-original')); await mkdir(join(repo, 'src')); await writeFile(join(repo, 'src/a.ts'), 'same bytes');
  } });
  assert.deepEqual(await context.capture(contextRequest(repo, ['src']), contextOptions()), { ok: false, code: 'CONTEXT_UNSTABLE' });
});
test('private context transfer preserves UTF-8 in bounded frames and rejects malformed or oversized pages', async () => {
  const { PassThrough, Readable } = await import('node:stream');
  const { readContextFrames, writeContextFrames } = await import('../../src/platform/macos/discovery/context-framing.js');
  const stream = new PassThrough(), expected = { text: 'Maestro 🎼\n'.repeat(10000) };
  const reading = readContextFrames(stream); await writeContextFrames(stream, expected); assert.deepEqual(await reading, expected);
  for (const frame of ['{"data":""}\n', '{"data":"a!="}\n', '{"data":"YQ==","path":"/forbidden"}\n']) await assert.rejects(readContextFrames(Readable.from([Buffer.from(frame)])), /INVALID_REQUEST/);
  await assert.rejects(readContextFrames(Readable.from([Buffer.alloc(32769, 120)])), /CONTEXT_LIMIT/);
});
