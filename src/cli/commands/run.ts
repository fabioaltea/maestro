import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { findProjectRoot, resolveProjectPaths, agentFilePath } from '../../utils/paths.js';
import { BacklogManager } from '../../core/backlog-manager.js';
import { buildTaskContext } from '../../core/task-runtime.js';

/**
 * Run a task using the provider configured in .maestro/config.yaml:
 *  - claude   → spawn `claude --agent <assignee> /run <task-id>`
 *  - copilot  → spawn `gh copilot suggest -t shell` with persona + task context
 *  - codex    → spawn `codex --full-auto` with persona + task context
 */
export async function runRun(taskId?: string): Promise<void> {
  const root = findProjectRoot();
  if (!root) {
    console.error('[maestro] Not in a maestro project. Run `maestro init` first.');
    process.exit(1);
  }
  const paths = resolveProjectPaths(root);
  const provider = paths.provider;
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
  const personaFile = agentFilePath(paths, assignee);
  if (!existsSync(personaFile)) {
    console.error(`[maestro] Agent '${assignee}' not found at ${personaFile}.`);
    console.error(`           Run staffing (ARCH-005) first or fix the assignee field.`);
    process.exit(1);
  }

  console.log(`[maestro] Running ${task.id} (${task.title}) on agent '${assignee}' via ${provider}`);

  switch (provider) {
    case 'claude': {
      const probe = spawnSync('claude', ['--help'], { stdio: 'pipe', shell: true });
      if (probe.error && (probe.error as NodeJS.ErrnoException).code === 'ENOENT') {
        console.error('[maestro] claude CLI not found on PATH. Install Claude Code first.');
        process.exit(1);
      }
      const r = spawnSync('claude', ['--agent', assignee, `/run ${task.id}`], {
        stdio: 'inherit',
        cwd: root,
      });
      if (r.error) {
        console.error('[maestro] failed to launch claude:', r.error.message);
        process.exit(1);
      }
      break;
    }

    case 'copilot': {
      const probe = spawnSync('copilot', ['--version'], { stdio: 'pipe', shell: true });
      if (probe.error && (probe.error as NodeJS.ErrnoException).code === 'ENOENT') {
        console.error('[maestro] copilot CLI not found on PATH. Install GitHub Copilot CLI first.');
        process.exit(1);
      }
      const persona = readFileSync(personaFile, 'utf8');
      const context = buildTaskContext(task, paths);
      const prompt = `${persona}\n\n---\n\n${context}`;
      const r = spawnSync('copilot', [prompt], {
        stdio: 'inherit',
        cwd: root,
        shell: true,
      });
      if (r.error) {
        console.error('[maestro] failed to launch copilot:', r.error.message);
        process.exit(1);
      }
      break;
    }

    case 'codex': {
      const probe = spawnSync('codex', ['--version'], { stdio: 'pipe', shell: true });
      if (probe.error && (probe.error as NodeJS.ErrnoException).code === 'ENOENT') {
        console.error('[maestro] codex CLI not found on PATH. Install OpenAI Codex CLI (https://github.com/openai/codex) first.');
        process.exit(1);
      }
      const persona = readFileSync(personaFile, 'utf8');
      const context = buildTaskContext(task, paths);
      const prompt = `${persona}\n\n---\n\n${context}`;
      const r = spawnSync('codex', ['--full-auto', prompt], {
        stdio: 'inherit',
        cwd: root,
        shell: true,
      });
      if (r.error) {
        console.error('[maestro] failed to launch codex:', r.error.message);
        process.exit(1);
      }
      break;
    }

    default: {
      console.error(`[maestro] Unsupported provider '${provider}'. Supported: claude, copilot, codex.`);
      process.exit(1);
    }
  }
}

