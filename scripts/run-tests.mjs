import { readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';

const suites = process.argv.slice(2);
const selected = suites.length ? suites : ['unit', 'contract', 'integration'];
const allowed = new Set(['unit', 'contract', 'integration', 'acceptance']);
const files = [];
async function collect(directory) {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await collect(path);
    else if (entry.name.endsWith('.test.js')) files.push(path);
  }
}
for (const suite of selected) {
  if (!allowed.has(suite)) throw new Error(`Unknown test suite: ${suite}`);
  await collect(resolve('dist-tests/tests', suite));
}
if (!files.length) {
  console.error(`No compiled tests available for: ${selected.join(', ')}`);
  process.exitCode = 1;
} else {
  const child = spawn(process.execPath, ['--test', ...(selected.includes('acceptance') ? ['--test-concurrency=1'] : []), ...files.sort()], { stdio: 'inherit' });
  child.once('error', (error) => { console.error(error.message); process.exitCode = 1; });
  child.once('exit', (code, signal) => {
    if (signal) console.error(`Test runner terminated: ${signal}`);
    process.exitCode = code ?? 1;
  });
}
