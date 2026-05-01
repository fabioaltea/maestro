import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findProjectRoot, projectPathsFor } from '../../utils/paths.js';

export async function runLogs(taskId: string): Promise<void> {
  const root = findProjectRoot();
  if (!root) {
    console.error('[maestro] Not in a maestro project. Run `maestro init` first.');
    process.exit(1);
  }
  const paths = projectPathsFor(root);
  const logFile = join(paths.sessionsDir, taskId, 'transcript.log');
  if (!existsSync(logFile)) {
    console.error(`[maestro] No transcript log found for task '${taskId}' at ${logFile}`);
    process.exit(1);
  }
  process.stdout.write(readFileSync(logFile, 'utf8'));
}
