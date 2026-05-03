import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { findProjectRoot, resolveProjectPaths, agentFilePath } from '../../utils/paths.js';
import { BacklogManager } from '../../core/backlog-manager.js';
import { buildTaskContext } from '../../core/task-runtime.js';
import { isExtensionRegistered, dispatchToExtension } from '../../utils/vscode-bridge.js';
import { log } from '../../utils/logger.js';

const PROBE_ENV = {
  ...process.env,
  PATH: `/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/bin:/bin:${process.env.PATH ?? ''}`,
};

/**
 * Run a task using the provider configured in .maestro/config.yaml:
 *  - claude   → spawn `claude --agent <assignee> /run <task-id>`
 *  - copilot  → spawn `gh copilot suggest -t shell` with persona + task context
 *  - codex    → spawn `codex --full-auto` with persona + task context
 */
export async function runRun(taskId?: string): Promise<void> {
  const root = findProjectRoot();
  if (!root) {
    log.error('not in a maestro project — run `maestro init` first');
    process.exit(1);
  }
  const paths = resolveProjectPaths(root);
  const provider = paths.provider;
  const manager = new BacklogManager();

  let task;
  if (taskId) {
    task = manager.getTask(paths, taskId);
    if (!task) {
      log.error(`task '${taskId}' not found`);
      process.exit(1);
    }
    if (task.status !== 'ready' && task.status !== 'in_progress') {
      log.error(`task '${taskId}' is '${task.status}' — must be 'ready' or 'in_progress'`);
      process.exit(1);
    }
    const all = manager.getTasks(paths);
    const doneIds = new Set(all.filter((t) => t.status === 'done').map((t) => t.id));
    const unmet = task.prerequisites.filter((p) => !doneIds.has(p));
    if (unmet.length > 0) {
      log.error(`task '${taskId}' has unmet prerequisites: ${unmet.join(', ')}`);
      process.exit(1);
    }
  } else {
    task = manager.getReadyTask(paths);
    if (!task) {
      log.info('no ready tasks in backlog');
      return;
    }
  }

  const assignee = task.assignee;
  const personaFile = agentFilePath(paths, assignee);
  if (!existsSync(personaFile)) {
    log.error(`agent '${assignee}' not found at ${personaFile}`);
    log.step('run staffing (ARCH-005) first or fix the assignee field');
    process.exit(1);
  }

  log.info(`running ${task.id} — ${task.title}  →  ${assignee}  (${provider})`);

  // Route to VSCode extension if registered for this project.
  if (isExtensionRegistered(paths.maestroDir)) {
    log.step('VSCode extension registered — routing to agent terminal...');
    const routed = await dispatchToExtension(paths.maestroDir, {
      action: 'runTask',
      taskId: task.id,
      taskStatus: task.status,
      taskAssignee: assignee,
    });
    if (routed) {
      log.ok('routed to VSCode extension — see the agent terminal');
      return;
    }
    log.warn('extension did not respond in time — spawning directly');
  }

  switch (provider) {
    case 'claude': {
      const probe = spawnSync('claude', ['--help'], { stdio: 'pipe', env: PROBE_ENV });
      if (probe.error && (probe.error as NodeJS.ErrnoException).code === 'ENOENT') {
        log.error('claude CLI not found on PATH — install Claude Code first');
        process.exit(1);
      }
      const r = spawnSync('claude', ['--agent', assignee, `/run ${task.id}`], {
        stdio: 'inherit',
        cwd: root,
        env: PROBE_ENV,
      });
      if (r.error) {
        log.error('failed to launch claude:', r.error.message);
        process.exit(1);
      }
      break;
    }

    case 'copilot': {
      const probe = spawnSync('copilot', ['--version'], { stdio: 'pipe', env: PROBE_ENV });
      if (probe.error && (probe.error as NodeJS.ErrnoException).code === 'ENOENT') {
        log.error('copilot CLI not found on PATH — install GitHub Copilot CLI first');
        process.exit(1);
      }
      const persona = readFileSync(personaFile, 'utf8');
      const context = buildTaskContext(task, paths);
      const prompt = `${persona}\n\n---\n\n${context}`;
      const r = spawnSync('copilot', [prompt], { stdio: 'inherit', cwd: root, env: PROBE_ENV });
      if (r.error) {
        log.error('failed to launch copilot:', r.error.message);
        process.exit(1);
      }
      break;
    }

    case 'codex': {
      const probe = spawnSync('codex', ['--version'], { stdio: 'pipe', env: PROBE_ENV });
      if (probe.error && (probe.error as NodeJS.ErrnoException).code === 'ENOENT') {
        log.error('codex CLI not found on PATH — install OpenAI Codex CLI first');
        process.exit(1);
      }
      const persona = readFileSync(personaFile, 'utf8');
      const context = buildTaskContext(task, paths);
      const prompt = `${persona}\n\n---\n\n${context}`;
      const r = spawnSync('codex', ['--full-auto', prompt], { stdio: 'inherit', cwd: root, env: PROBE_ENV });
      if (r.error) {
        log.error('failed to launch codex:', r.error.message);
        process.exit(1);
      }
      break;
    }

    default: {
      log.error(`unsupported provider '${provider}' — supported: claude, copilot, codex`);
      process.exit(1);
    }
  }
}

