import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { stat, symlink, writeFile, readFile } from 'node:fs/promises';
import { ReceiptStore } from '../../src/main/receipt-store.ts';
import { createScratch, failAt } from '../fixtures/desktop.ts';
const metadata = (archivePath: string) => ({ requestId: randomUUID(), namespace: 'foundation' as const, action: 'start', archivePath, storeId: randomUUID(), projectId: null, expectedRevision: null, intentHash: 'a'.repeat(64) });
test('receipt is private, durable before return, immutable in identity and never silently evicted', async () => {
  const f = await createScratch(), path = join(f.userData, 'operation-receipts');
  try {
    const points: string[] = [], store = new ReceiptStore(path, p => points.push(p));
    const meta = metadata(f.archive), prepared = await store.create(meta);
    assert.deepEqual(points, ['file.synced', 'file.renamed', 'directory.synced']);
    assert.equal(prepared.phase, 'PREPARED');
    assert.equal((await stat(path)).mode & 0o777, 0o700);
    assert.equal((await stat(join(path, `${meta.requestId}.json`))).mode & 0o777, 0o600);
    assert.equal((await new ReceiptStore(path).list())[0]!.requestId, meta.requestId);
    await assert.rejects(() => store.dismiss(meta.requestId));
    await assert.rejects(() => store.update(meta.requestId, { storeId: randomUUID() }));
    for (let i = 1; i < 100; i++) await store.create(metadata(f.archive));
    await assert.rejects(() => store.create(metadata(f.archive)), { message: 'RECEIPT_LIMIT' });
    assert.equal((await store.list()).length, 100);
    await store.update(meta.requestId, { phase: 'TERMINAL', outcome: 'SUCCEEDED' });
    await store.dismiss(meta.requestId); assert.equal((await store.list()).length, 99);
    assert.ok(!(await readFile(join(path, `${(await store.list())[0]!.requestId}.json`), 'utf8')).includes('canonicalIntent'));
  } finally { await f.cleanup(); }
});
test('fault after file sync never reports success and corrupt or symlink receipts block new work', async () => {
  const f = await createScratch();
  try {
    const path = join(f.userData, 'receipts'), store = new ReceiptStore(path, failAt('file.synced'));
    await assert.rejects(() => store.create(metadata(f.archive)));
    await assert.rejects(() => new ReceiptStore(path).create(metadata(f.archive)));
    const otherPath = join(f.userData, 'other'), other = new ReceiptStore(otherPath);
    const first = await other.create(metadata(f.archive));
    await writeFile(join(otherPath, `${first.requestId}.json`), '{bad');
    await assert.rejects(() => other.list());
    const target = join(f.directory, 'untouched'); await writeFile(target, 'preserve');
    const safePath = join(f.userData, 'safe'), safe = new ReceiptStore(safePath);
    await safe.list(); await symlink(target, join(safePath, `${randomUUID()}.json`));
    await assert.rejects(() => safe.create(metadata(f.archive))); assert.equal(await readFile(target, 'utf8'), 'preserve');
  } finally { await f.cleanup(); }
});
