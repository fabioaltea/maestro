import { findProjectRoot, projectPathsFor } from '../../utils/paths.js';
import { BacklogManager } from '../../core/backlog-manager.js';
import { StateStore } from '../../core/state-store.js';
import { EventBus } from '../../core/event-bus.js';
import { buildTaskContext } from '../../core/task-runtime.js';

export async function runNextTask(): Promise<void> {
  const root = findProjectRoot();
  if (!root) {
    console.error('[maestro] Not in a maestro project. Run `maestro init` first.');
    process.exit(1);
  }
  const paths = projectPathsFor(root);
  const manager = new BacklogManager();
  const store = new StateStore(paths.stateDb);
  try {
    const task = manager.getReadyTask(paths);
    if (!task) {
      const all = manager.getTasks(paths);
      const remaining = all.filter((t) => t.status !== 'done' && t.status !== 'failed').length;
      if (remaining === 0) {
        console.log('DONE — all tasks completed.');
      } else {
        console.log(`NO_READY_TASKS — ${remaining} task(s) remain but none are ready (waiting on prerequisites or user input).`);
      }
      return;
    }

    if (task.status === 'ready') {
      manager.updateTask(paths, store, task.id, {
        status: 'in_progress',
        started_at: new Date().toISOString(),
      });
      const bus = new EventBus(paths.eventsLog, store);
      bus.publish({ type: 'task.started', agent: task.assignee, task_id: task.id, data: {} });
    }

    const ctx = buildTaskContext(task, paths);
    console.log(`# next-task: ${task.id}\n`);
    console.log(ctx);
  } finally {
    store.close();
  }
}
