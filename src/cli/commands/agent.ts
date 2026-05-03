import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findProjectRoot, resolveProjectPaths, agentFilePath } from '../../utils/paths.js';

export async function runAgent(name: string): Promise<void> {
  const root = findProjectRoot();
  if (!root) {
    console.error('[maestro] Not in a maestro project. Run `maestro init` first.');
    process.exit(1);
  }
  const paths = resolveProjectPaths(root);
  const filePath = agentFilePath(paths, name);
  if (!existsSync(filePath)) {
    console.error(`[maestro] Agent '${name}' not found at ${filePath}`);
    process.exit(1);
  }
  process.stdout.write(readFileSync(filePath, 'utf8'));
}
