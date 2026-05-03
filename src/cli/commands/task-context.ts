import { findProjectRoot, resolveProjectPaths } from '../../utils/paths.js';
import { BacklogManager } from '../../core/backlog-manager.js';
import { StateStore } from '../../core/state-store.js';
import { EventBus } from '../../core/event-bus.js';
import { buildTaskContext } from '../../core/task-runtime.js';

export async function runTaskContext(taskId: string): Promise<void> {
  const root = findProjectRoot();
  if (!root) {
    console.error('[maestro] Not in a maestro project.');
    process.exit(1);
  }
  const paths = resolveProjectPaths(root);
  const manager = new BacklogManager();
  const store = new StateStore(paths.stateDb);
  try {
    const task = manager.getTask(paths, taskId);
    if (!task) {
      console.error(`ERROR — task '${taskId}' not found.`);
      process.exit(1);
    }
    if (task.status !== 'ready' && task.status !== 'in_progress') {
      console.error(
        `ERROR — task '${taskId}' has status '${task.status}'. Expected 'ready' or 'in_progress'. ` +
        `Run \`maestro next-task\` to see what's runnable.`,
      );
      process.exit(1);
    }
    if (task.status === 'ready') {
      manager.updateTask(paths, store, taskId, {
        status: 'in_progress',
        started_at: new Date().toISOString(),
      });
      const bus = new EventBus(paths.eventsLog, store);
      bus.publish({ type: 'task.started', agent: task.assignee, task_id: taskId, data: {} });
    }
    console.log(`# task-context: ${taskId}\n`);
    console.log(buildTaskContext(task, paths));
  } finally {
    store.close();
  }
}
