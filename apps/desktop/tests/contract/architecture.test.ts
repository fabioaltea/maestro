import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createScratch, repositoryRoot } from '../fixtures/desktop.ts';
test('desktop guard rejects runtime core imports and privilege in untrusted zones', async () => {
  const f = await createScratch();
  try {
    const core = join(f.directory, 'core'), desktop = join(f.directory, 'desktop');
    await mkdir(core); await mkdir(desktop);
    for (const [zone, source] of [
      ['renderer', 'import fs from "node:fs";'], ['renderer', 'process.env.HOME;'], ['renderer', 'import("node:child_process");'],
      ['shared', 'import sqlite from "better-sqlite3";'], ['main', 'import "../../../../src/bootstrap.ts";'], ['preload', 'import fs from "node:fs";'],
    ]) {
      await mkdir(join(desktop, zone!), { recursive: true });
      const file = join(desktop, zone!, 'probe.ts'); await writeFile(file, source!);
      await assert.rejects(() => promisify(execFile)(process.execPath, [join(repositoryRoot, 'scripts/check-architecture.mjs'), core, desktop]), `guard failed to reject ${zone}: ${source}`);
      await writeFile(file, 'export {};');
    }
  } finally { await f.cleanup(); }
});
