import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { findProjectRoot, projectPathsFor } from '../../utils/paths.js';

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';

export async function runDocs(): Promise<void> {
  const root = findProjectRoot();
  if (!root) {
    console.error('[maestro] Not in a maestro project. Run `maestro init` first.');
    process.exit(1);
  }
  const paths = projectPathsFor(root);

  if (!existsSync(paths.docs)) {
    console.log('[maestro] No docs/ directory found.');
    return;
  }

  const entries = readdirSync(paths.docs, { withFileTypes: true });
  const files = entries.filter((e) => e.isFile());

  if (files.length === 0) {
    console.log('[maestro] docs/ is empty.');
    return;
  }

  console.log('');
  for (const entry of files) {
    const filePath = join(paths.docs, entry.name);
    const size = statSync(filePath).size;
    const sizeStr = size < 1024 ? `${size}B` : `${(size / 1024).toFixed(1)}K`;
    console.log(`  ${BOLD}${entry.name}${RESET}  ${DIM}${sizeStr}${RESET}`);
  }
  console.log('');
}
