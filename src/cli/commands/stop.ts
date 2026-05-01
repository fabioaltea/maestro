import { findProjectRoot, projectPathsFor } from '../../utils/paths.js';
import { StateStore } from '../../core/state-store.js';
import { BacklogManager } from '../../core/backlog-manager.js';
import { TmuxSessionManager } from '../../tmux/session-manager.js';

export async function runStop(agent: string): Promise<void> {
  const root = findProjectRoot();
  if (!root) {
    console.error('[maestro] Not in a maestro project. Run `maestro init` first.');
    process.exit(1);
  }
  const paths = projectPathsFor(root);
  const sessionName = `agent-${agent}`;
  const tmux = new TmuxSessionManager();

  // Kill tmux session
  tmux.kill(sessionName);

  // Mark any in_progress task for this agent as failed
  const store = new StateStore(paths.stateDb);
  try {
    const manager = new BacklogManager();
    const tasks = manager.getTasks(paths);
    const inProgress = tasks.filter((t) => t.assignee === agent && t.status === 'in_progress');
    for (const task of inProgress) {
      manager.updateTask(paths, store, task.id, { status: 'failed' });
      console.log(`[maestro] Marked task ${task.id} as failed (stopped by user).`);
    }
  } finally {
    store.close();
  }

  console.log(`[maestro] Session '${sessionName}' stopped.`);
}
