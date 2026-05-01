import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { findProjectRoot, packageRoot, projectPathsFor, userGlobalConfigFile } from '../../utils/paths.js';
import { BacklogManager } from '../../core/backlog-manager.js';
import { TmuxSessionManager } from '../../tmux/session-manager.js';
import { ProjectConfigSchema, GlobalConfigSchema } from '../../schemas/config.js';
import YAML from 'yaml';

function resolveMaestroBin(): string {
  return join(packageRoot(), 'bin', 'maestro');
}

/**
 * Validate API key only when provider_mode is anthropic-api.
 * Default mode is claude-code (Pro/Max plan via claude CLI) — no API key needed.
 */
function validateProviderConfig(projectRoot: string): void {
  const paths = projectPathsFor(projectRoot);
  let providerMode = 'claude-code';
  if (existsSync(paths.configFile)) {
    try {
      const cfg = ProjectConfigSchema.parse(YAML.parse(readFileSync(paths.configFile, 'utf8')));
      providerMode = cfg.provider_mode ?? 'claude-code';
    } catch {}
  }

  if (providerMode === 'anthropic-api') {
    // API key required
    if (process.env['ANTHROPIC_API_KEY']) return;
    const cfgFile = userGlobalConfigFile();
    if (existsSync(cfgFile)) {
      try {
        const cfg = GlobalConfigSchema.parse(YAML.parse(readFileSync(cfgFile, 'utf8')));
        if (cfg.anthropic_api_key) return;
      } catch {}
    }
    console.error(
      '[maestro] provider_mode is anthropic-api but ANTHROPIC_API_KEY is not set.\n' +
      '  Set it via: export ANTHROPIC_API_KEY=sk-ant-...\n' +
      '  Or add it to ~/.maestro/config.yaml as: anthropic_api_key: sk-ant-...',
    );
    process.exit(1);
  }
  // claude-code mode: no API key needed — uses claude CLI auth (Pro/Max plan)
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runRun(taskId?: string): Promise<void> {
  const root = findProjectRoot();
  if (!root) {
    console.error('[maestro] Not in a maestro project. Run `maestro init` first.');
    process.exit(1);
  }

  validateProviderConfig(root);

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
      console.error(`[maestro] Task '${taskId}' has status '${task.status}'; must be 'ready' or 'in_progress' to run.`);
      process.exit(1);
    }
    // Check prerequisites
    const allTasks = manager.getTasks(paths);
    const doneIds = new Set(allTasks.filter((t) => t.status === 'done').map((t) => t.id));
    const unmet = task.prerequisites.filter((p) => !doneIds.has(p));
    if (unmet.length > 0) {
      console.error(`[maestro] Task '${taskId}' has unmet prerequisites: ${unmet.join(', ')}`);
      process.exit(1);
    }
  } else {
    task = manager.getReadyTask(paths);
    if (!task) {
      console.log('[maestro] No ready tasks in backlog. Check `maestro backlog` for current state.');
      process.exit(0);
    }
  }

  if (!TmuxSessionManager.isAvailable()) {
    console.error('[maestro] tmux is not available. Please install tmux.');
    process.exit(1);
  }

  const sessionName = `agent-${task.assignee}`;
  const tmux = new TmuxSessionManager();

  if (!tmux.has(sessionName)) {
    const nodeExe = process.execPath;
    const maestroBin = resolveMaestroBin();
    const argv = [nodeExe, maestroBin, '_run-agent', root, task.id];
    tmux.create(sessionName, argv);
    // Give the process a moment to start before we attach
    await sleep(300);
  }

  console.log(`[maestro] Attaching to session '${sessionName}' for task ${task.id}: ${task.title}`);
  tmux.attachOrSwitch(sessionName);
}
