import { findProjectRoot, projectPathsFor } from '../../utils/paths.js';
import { BacklogManager } from '../../core/backlog-manager.js';
import { EventBus } from '../../core/event-bus.js';
import { buildTaskContext, promoteReadyTasks, verifyArtifacts } from '../../core/task-runtime.js';

export async function runMarkDone(taskId: string): Promise<void> {
  const root = findProjectRoot();
  if (!root) {
    console.error('[maestro] Not in a maestro project.');
    process.exit(1);
  }
  const paths = projectPathsFor(root);
  const manager = new BacklogManager();
  const bus = new EventBus(paths.eventsLog);

  const task = manager.getTask(paths, taskId);
  if (!task) {
    console.error(`ERROR — task ${taskId} not found in backlog.`);
    process.exit(1);
  }
  if (task.status === 'done') {
    console.error(`ERROR — task ${taskId} already done.`);
    process.exit(1);
  }

  const check = verifyArtifacts(taskId, paths, manager);
  if (!check.ok) {
    console.error(`ARTIFACT_CHECK_FAILED — task ${taskId} cannot be marked done. Missing:`);
    for (const m of check.missing) console.error(`  - ${m}`);
    console.error('Produce the missing artifacts and try again.');
    process.exit(1);
  }

  manager.updateTask(paths, taskId, {
    status: 'done',
    completed_at: new Date().toISOString(),
  });
  bus.publish({ type: 'task.completed', agent: task.assignee, task_id: taskId, data: {} });

  const { promoted } = promoteReadyTasks(paths, bus, manager);

  console.log(`DONE — ${taskId} marked complete.${check.details ? ` (${check.details})` : ''}`);
  if (promoted.length > 0) {
    console.log(`PROMOTED — ${promoted.join(', ')} now ready.`);
  }

  const next = manager.getReadyTask(paths);
  if (!next) {
    const all = manager.getTasks(paths);
    const remaining = all.filter((t) => t.status !== 'done' && t.status !== 'failed').length;
    if (remaining === 0) {
      console.log('\nDONE — all tasks completed. The autonomous loop is finished.');
    } else {
      console.log(`\nNO_READY_TASKS — ${remaining} task(s) remain but none are ready right now.`);
    }
    return;
  }

  manager.updateTask(paths, next.id, {
    status: 'in_progress',
    started_at: new Date().toISOString(),
  });
  bus.publish({ type: 'task.started', agent: next.assignee, task_id: next.id, data: {} });

  console.log(`\n---\n# next-task: ${next.id}\n`);
  console.log(buildTaskContext(next, paths));
}
