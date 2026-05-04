import { findProjectRoot, projectPathsFor } from '../../utils/paths.js';
import { BacklogManager } from '../../core/backlog-manager.js';
import { TmuxSessionManager } from '../../tmux/session-manager.js';

export async function runStop(agent: string): Promise<void> {
  const root = findProjectRoot();
  if (!root) {
    console.error('[maestro] Not in a maestro project. Run `maestro init` first.');
    process.exit(1);
  }
  const paths = projectPathsFor(root);
  const tmux = new TmuxSessionManager();
  tmux.kill(`agent-${agent}`);

  const manager = new BacklogManager();
  const tasks = manager.getTasks(paths);
  const inProgress = tasks.filter((t) => t.assignee === agent && t.status === 'in_progress');
  for (const task of inProgress) {
    manager.updateTask(paths, task.id, { status: 'failed' });
    console.log(`[maestro] Marked task ${task.id} as failed (stopped by user).`);
  }

  console.log(`[maestro] Session 'agent-${agent}' stopped.`);
}
