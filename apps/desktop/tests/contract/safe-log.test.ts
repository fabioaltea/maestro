import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { SafeLog } from '../../src/main/safe-log.ts';
import { createScratch } from '../fixtures/desktop.ts';
test('logs accept only redacted metadata and retain at most two bounded files', async () => {
  const f = await createScratch();
  try {
    const path = join(f.directory, 'logs'), log = new SafeLog(path, 256);
    await assert.rejects(() => log.write({ code: 'OK', path: 'secret' } as never));
    await assert.rejects(() => log.write({ code: 'secret raw stderr' }));
    for (let i = 0; i < 20; i++) await log.write({ code: 'OK', action: 'status', durationMs: i });
    const files = await readdir(path); assert.ok(files.length <= 2);
    for (const name of files) { assert.ok((await stat(join(path, name))).size <= 256); assert.ok(!(await readFile(join(path, name), 'utf8')).includes('secret')); }
  } finally { await f.cleanup(); }
});
