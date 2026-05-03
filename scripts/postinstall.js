#!/usr/bin/env node
// Best-effort: install the bundled Maestro VSCode extension into every
// VSCode-family editor we can find on PATH. Silent on failure — this hook
// must never break the package install.

import { existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.env.MAESTRO_SKIP_EXTENSION_INSTALL === '1') process.exit(0);
if (process.env.CI && !process.env.MAESTRO_FORCE_EXTENSION_INSTALL) process.exit(0);

const here = dirname(fileURLToPath(import.meta.url));
const distDir = join(here, '..', 'vscode-extension', 'dist');
if (!existsSync(distDir)) process.exit(0);

let vsix;
try {
  const entries = readdirSync(distDir).filter((f) => f.endsWith('.vsix')).sort();
  if (entries.length === 0) process.exit(0);
  vsix = join(distDir, entries[entries.length - 1]);
} catch {
  process.exit(0);
}

const opts = { stdio: 'pipe', shell: true };
const installed = [];
for (const cli of ['code', 'cursor', 'windsurf', 'codium']) {
  const probe = spawnSync(cli, ['--version'], opts);
  if (probe.status !== 0 || probe.error) continue;
  const r = spawnSync(cli, ['--install-extension', vsix, '--force'], opts);
  if (r.status === 0 && !r.error) installed.push(cli);
}

if (installed.length > 0) {
  console.log(`[maestro] VSCode extension installed in: ${installed.join(', ')}`);
}
