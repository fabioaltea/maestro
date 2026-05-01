import { existsSync, rmSync } from 'node:fs';
import { findProjectRoot, projectPathsFor } from '../../utils/paths.js';

export async function runReset(opts: { hard: boolean }): Promise<void> {
  const root = findProjectRoot();
  if (!root) {
    console.error('[maestro] Not in a maestro project. Run `maestro init` first.');
    process.exit(1);
  }
  const paths = projectPathsFor(root);

  if (existsSync(paths.maestroDir)) {
    rmSync(paths.maestroDir, { recursive: true, force: true });
    console.log('[maestro] Removed .maestro/ (runtime state).');
  }

  if (opts.hard) {
    if (existsSync(paths.docs)) {
      rmSync(paths.docs, { recursive: true, force: true });
      console.log('[maestro] Removed docs/.');
    }
    if (existsSync(paths.agents)) {
      rmSync(paths.agents, { recursive: true, force: true });
      console.log('[maestro] Removed .agents/.');
    }
    console.log('[maestro] Hard reset complete. Run `maestro init` to start fresh.');
  } else {
    console.log('[maestro] Reset complete. docs/ and .agents/ preserved. Run `maestro init` to reinitialize state.');
  }
}

