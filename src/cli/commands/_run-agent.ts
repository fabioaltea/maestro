import { resolveProjectPaths } from '../../utils/paths.js';
import { BacklogManager } from '../../core/backlog-manager.js';
import { runArchitectTask } from '../../agents/architect/runner.js';

export async function runAgentTask(projectRoot: string, taskId: string): Promise<void> {
  try {
    const paths = resolveProjectPaths(projectRoot);
    const manager = new BacklogManager();
    const task = manager.getTask(paths, taskId);
    if (!task) {
      console.error(`[maestro] Task ${taskId} not found in backlog at ${paths.backlogJson}`);
      process.exit(1);
    }

    if (task.assignee === 'architect') {
      await runArchitectTask(projectRoot, taskId);
    } else {
      console.error(
        `[maestro] Engineer runner not yet implemented (coming in step 14). Task: ${taskId}, assignee: ${task.assignee}`,
      );
      process.exit(1);
    }
  } catch (err) {
    console.error('\n[maestro] ── Fatal error in agent runner ──────────────────────');
    console.error(err instanceof Error ? err.message : String(err));
    if (err instanceof Error && err.stack) {
      console.error('\nStack trace:');
      console.error(err.stack.split('\n').slice(1).join('\n'));
    }
    console.error('─────────────────────────────────────────────────────────────');
    process.exit(1);
  }
}
