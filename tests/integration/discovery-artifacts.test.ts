import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { chmod, link, lstat, readFile, readdir, symlink, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SQLiteStore } from '../../src/storage/sqlite-store.js';
import { artifactFixture, value, type ArtifactStorage } from '../fixtures/discovery-artifacts.js';

const body = Buffer.from('private artifact\n');
test('reserved UUID object is private and durable before metadata publication; reads are bounded and hash checked', async t => {
  const steps: string[] = [];
  const f = await artifactFixture(t, point => { if (point.startsWith('artifact.')) steps.push(point); });
  const a = value(f.artifacts.reserveDiscoveryArtifact('CORPUS', 1024));
  assert.equal(a.state, 'RESERVED'); assert.equal(a.artifactId, a.relativeKey);
  assert.equal(f.artifacts.readDiscoveryArtifact(a.artifactId, 0, 8192).ok, false);
  const published = value(f.artifacts.publishDiscoveryArtifact(a.artifactId, body));
  assert.equal(published.sha256, createHash('sha256').update(body).digest('hex'));
  const root = join(f.directory, 'discovery'), path = join(root, 'objects', a.artifactId);
  assert.equal((await lstat(root)).mode & 0o777, 0o700); assert.equal((await lstat(path)).mode & 0o777, 0o600);
  assert.equal((await lstat(path)).nlink, 1); assert.deepEqual(await readFile(path), body);
  assert.deepEqual(steps, ['artifact.reserved', 'artifact.written', 'artifact.fileSynced', 'artifact.published', 'artifact.directorySynced', 'artifact.beforeCommit', 'artifact.committed']);
  const page = value(f.artifacts.readDiscoveryArtifact(a.artifactId, 2, 4));
  assert.deepEqual(Buffer.from(page.bytes), body.subarray(2, 6)); assert.equal(page.totalBytes, body.length);
  assert.equal(f.artifacts.readDiscoveryArtifact(a.artifactId, 0, 8193).ok, false);
  assert.equal(f.artifacts.readDiscoveryArtifact('../state.sqlite', 0, 10).ok, false);
  assert.equal(f.artifacts.publishDiscoveryArtifact(a.artifactId, Buffer.from('overwrite')).ok, false);
});
for (const point of ['artifact.reserved', 'artifact.written', 'artifact.fileSynced', 'artifact.published', 'artifact.directorySynced', 'artifact.beforeCommit', 'artifact.committed']) {
  test(`interruption at ${point} preserves files without publishing by filename`, async t => {
    let fault = false;
    const f = await artifactFixture(t, step => { if (fault && step === point) { fault = false; throw new Error('SIMULATED_PROCESS_LOSS'); } });
    fault = point === 'artifact.reserved'; const reserved = f.artifacts.reserveDiscoveryArtifact('DOCUMENT', 8192);
    let id: string;
    if (reserved.ok) { id = reserved.value.artifactId; fault = true; assert.equal(f.artifacts.publishDiscoveryArtifact(id, body).ok, false); }
    else { const records = await readdir(join(f.directory, 'discovery', 'objects')); assert.deepEqual(records, []); id = randomUUID(); }
    const before = [...await readdir(join(f.directory, 'discovery', 'objects')), ...await readdir(join(f.directory, 'discovery', 'staging'))].sort();
    f.store.close(); const reopened = new SQLiteStore({ path: f.path }); t.after(() => reopened.close());
    const artifacts = reopened as unknown as ArtifactStorage;
    value(artifacts.reconcileDiscoveryArtifacts());
    assert.deepEqual([...await readdir(join(f.directory, 'discovery', 'objects')), ...await readdir(join(f.directory, 'discovery', 'staging'))].sort(), before);
    const read = artifacts.readDiscoveryArtifact(id, 0, 8192);
    assert.equal(read.ok, point === 'artifact.committed');
    const budget = value(artifacts.getDiscoveryBudget()); assert.equal(budget.reservedBytes, 0);
    assert.ok(budget.allocatedFiles >= before.length);
  });
}
test('missing, modified, symbolic and hard linked objects are never returned; outside files are preserved', async t => {
  const f = await artifactFixture(t);
  for (const mutation of ['missing', 'corrupt', 'symlink', 'hardlink', 'permissions']) {
    const a = value(f.artifacts.reserveDiscoveryArtifact('CORPUS', 1024)); value(f.artifacts.publishDiscoveryArtifact(a.artifactId, body));
    const path = join(f.directory, 'discovery', 'objects', a.artifactId), outside = join(f.directory, randomUUID());
    await writeFile(outside, 'outside canary', { mode: 0o600 });
    if (mutation === 'corrupt') await writeFile(path, 'changed');
    else if (mutation === 'permissions') await chmod(path, 0o644);
    else { await unlink(path); if (mutation === 'symlink') await symlink(outside, path); if (mutation === 'hardlink') await link(outside, path); }
    assert.deepEqual(f.artifacts.readDiscoveryArtifact(a.artifactId, 0, 8192), { ok: false, code: 'ARTIFACT_CORRUPT' });
    assert.equal(await readFile(outside, 'utf8'), 'outside canary');
  }
});
test('unknown UUID objects are counted and preserved but cannot become authoritative; replaced roots fail closed', async t => {
  const f = await artifactFixture(t), id = randomUUID(), root = join(f.directory, 'discovery', 'objects');
  await writeFile(join(root, id), body, { mode: 0o600 });
  value(f.artifacts.reconcileDiscoveryArtifacts()); assert.equal(value(f.artifacts.getDiscoveryBudget()).allocatedFiles, 1);
  assert.equal(f.artifacts.readDiscoveryArtifact(id, 0, 8192).ok, false); assert.deepEqual(await readFile(join(root, id)), body);
  await chmod(root, 0o755); assert.equal(f.artifacts.reserveDiscoveryArtifact('OUTPUT', 100).ok, false);
});
test('ownership check rejects a different uid independently of file permissions', async () => {
  const modulePath = new URL('../../src/storage/discovery-artifacts.js', import.meta.url);
  const { isPrivateArtifact } = await import(modulePath.href) as { isPrivateArtifact(stat: { uid: number; mode: number; nlink: number; isFile(): boolean }, uid: number): boolean };
  const stat = { uid: process.getuid!(), mode: 0o100600, nlink: 1, isFile: () => true };
  assert.equal(isPrivateArtifact(stat, stat.uid), true); assert.equal(isPrivateArtifact({ ...stat, uid: stat.uid + 1 }, stat.uid), false);
});
test('writer worker publishes and pages bytes; readonly worker never creates or repairs artifacts', async t => {
  const { openStorage } = await import('../../src/storage/worker.js');
  const f = await artifactFixture(t); f.store.close(); const writer = await openStorage({ path: f.path });
  let id: string;
  try {
    const a = value(await writer.reserveDiscoveryArtifact!('DOCUMENT', 1024)); id = a.artifactId;
    value(await writer.publishDiscoveryArtifact!(id, body));
    assert.deepEqual(Buffer.from(value(await writer.readDiscoveryArtifact!(id, 0, 8192)).bytes), body);
  } finally { await writer.close(); }
  const reader = await openStorage({ path: f.path, readonly: true });
  try {
    assert.deepEqual(Buffer.from(value(await reader.readDiscoveryArtifact!(id, 0, 8192)).bytes), body);
    await assert.rejects(reader.reserveDiscoveryArtifact!('OUTPUT', 12), /UNAUTHORIZED/);
    await assert.rejects(reader.reconcileDiscoveryArtifacts!(), /UNAUTHORIZED/);
  } finally { await reader.close(); }
});
for (const point of ['artifact.fileSynced', 'artifact.directorySynced', 'artifact.committed']) {
  test(`actual SIGKILL at ${point} leaves only committed content readable after restart`, async t => {
    const { once } = await import('node:events'); const Database = (await import('better-sqlite3')).default;
    const f = await artifactFixture(t); f.store.close();
    const child = f.context.spawnNode([new URL('../fixtures/discovery-artifact-owner.js', import.meta.url).pathname, f.path, point]);
    const [code, signal] = await once(child, 'exit'); assert.equal(code, null); assert.equal(signal, 'SIGKILL');
    const db = new Database(f.path); const rows = db.prepare('SELECT artifact_id FROM discovery_artifacts').all() as { artifact_id: string }[]; db.close(); assert.equal(rows.length, 1);
    const reopened = new SQLiteStore({ path: f.path }); t.after(() => reopened.close());
    value(reopened.reconcileDiscoveryArtifacts());
    const read = reopened.readDiscoveryArtifact(rows[0]!.artifact_id, 0, 8192);
    assert.equal(read.ok, point === 'artifact.committed');
    assert.equal(value(reopened.getDiscoveryBudget()).reservedBytes, 0);
  });
}
