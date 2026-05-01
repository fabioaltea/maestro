import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { findProjectRoot, projectPathsFor } from '../../utils/paths.js';
import { BacklogManager } from '../../core/backlog-manager.js';

/**
 * Run a task: spawn `claude --agent <assignee>` with positional prompt `/run <task-id>`.
 * Claude reads the slash command, calls `maestro task-context <id>`, executes the task.
 */
export async function runRun(taskId?: string): Promise<void> {
  const root = findProjectRoot();
  if (!root) {
    console.error('[maestro] Not in a maestro project. Run `maestro init` first.');
    process.exit(1);
  }
  const paths = projectPathsFor(root);
  const manager = new BacklogManager();

  let task;
  if (taskId) {
    task = manager.getTask(paths, taskId);
    if (!task) {
      console.error(`[maestro] Task '${taskId}' not found.`);
      process.exit(1);
    }
    if (task.status !== 'ready' && task.status !== 'in_progress') {
      console.error(`[maestro] Task '${taskId}' has status '${task.status}'; must be 'ready' or 'in_progress'.`);
      process.exit(1);
    }
    const all = manager.getTasks(paths);
    const doneIds = new Set(all.filter((t) => t.status === 'done').map((t) => t.id));
    const unmet = task.prerequisites.filter((p) => !doneIds.has(p));
    if (unmet.length > 0) {
      console.error(`[maestro] Task '${taskId}' has unmet prerequisites: ${unmet.join(', ')}`);
      process.exit(1);
    }
  } else {
    task = manager.getReadyTask(paths);
    if (!task) {
      console.log('[maestro] No ready tasks in backlog.');
      return;
    }
  }

  const assignee = task.assignee;
  const personaFile = join(paths.agents, `${assignee}.md`);
  if (!existsSync(personaFile)) {
    console.error(`[maestro] Agent '${assignee}' not found at ${personaFile}.`);
    console.error(`           Run staffing (ARCH-005) first or fix the assignee field.`);
    process.exit(1);
  }

  const probe = spawnSync('claude', ['--help'], { stdio: 'pipe' });
  if (probe.error && (probe.error as NodeJS.ErrnoException).code === 'ENOENT') {
    console.error('[maestro] claude CLI not found on PATH. Install Claude Code first.');
    process.exit(1);
  }

  console.log(`[maestro] Running ${task.id} (${task.title}) on agent '${assignee}'`);

  const r = spawnSync('claude', ['--agent', assignee, `/run ${task.id}`], {
    stdio: 'inherit',
    cwd: root,
  });
  if (r.error) {
    console.error('[maestro] failed to launch claude:', r.error.message);
    process.exit(1);
  }
}
