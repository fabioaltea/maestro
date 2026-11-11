import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const checker = resolve('scripts/check-architecture.mjs');
const run = (root: string) => spawnSync(process.execPath, [checker, root], { encoding: 'utf8' });

test('domain and client reject OS, SQLite and core policy imports across syntax forms', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'maestro-architecture-'));
  t.after(() => rm(root, { recursive: true }));
  for (const directory of ['domain', 'client', 'ports']) await mkdir(join(root, directory));
  await writeFile(join(root, 'domain', 'states.ts'), "export type State = 'RUNNING';\n");
  await writeFile(join(root, 'ports', 'clock.ts'), 'export interface Clock { now(): number; }\n');
  await writeFile(join(root, 'client', 'good.ts'), "import type { State } from '../domain/states.js';\n");
  assert.equal(run(root).status, 0);
  await writeFile(join(root, 'domain', 'bad.ts'), "import fs from 'node:fs';\nexport { x } from '../storage/store.js';\n");
  await writeFile(join(root, 'client', 'bad.ts'), "await import('../core/operations.js');\nconst db = require('better-sqlite3');\nimport provider from '@vendor/provider-sdk';\nimport electron from 'electron';\n");
  const rejected = run(root);
  assert.equal(rejected.status, 1, rejected.stdout + rejected.stderr);
  assert.match(rejected.stderr, /domain\/bad.ts.*node:fs/);
  assert.match(rejected.stderr, /domain\/bad.ts.*storage/);
  assert.match(rejected.stderr, /client\/bad.ts.*core/);
  assert.match(rejected.stderr, /client\/bad.ts.*better-sqlite3/);
  assert.match(rejected.stderr, /client\/bad.ts.*provider-sdk/);
  assert.match(rejected.stderr, /client\/bad.ts.*electron/);
});

test('actual production sources obey the architecture boundaries', () => {
  const result = run(resolve('src'));
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
