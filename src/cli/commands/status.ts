import { existsSync, readFileSync } from 'node:fs';
import YAML from 'yaml';
import { findProjectRoot, projectPathsFor } from '../../utils/paths.js';
import { BacklogManager } from '../../core/backlog-manager.js';

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const RED = '\x1b[31m';
const GRAY = '\x1b[90m';

const STATUS_COLORS: Record<string, string> = {
  ready: GREEN,
  in_progress: YELLOW,
  awaiting_approval: CYAN,
  blocked: RED,
  blocked_needs_user: RED,
  done: GRAY,
  pending: DIM,
  failed: RED,
};

function badge(status: string): string {
  const color = STATUS_COLORS[status] ?? '';
  return `${color}${status}${RESET}`;
}

function requireProjectRoot(): string {
  const root = findProjectRoot();
  if (!root) {
    console.error('[maestro] Not in a maestro project. Run `maestro init` first.');
    process.exit(1);
  }
  return root;
}

export async function runStatus(): Promise<void> {
  const root = requireProjectRoot();
  const paths = projectPathsFor(root);
  const manager = new BacklogManager();
  const tasks = manager.getTasks(paths);

  let projectName = root;
  if (existsSync(paths.configFile)) {
    try {
      const cfg = YAML.parse(readFileSync(paths.configFile, 'utf8')) as { project_name?: string };
      projectName = cfg.project_name ?? root;
    } catch {}
  }

  console.log(`\n${BOLD}Project:${RESET} ${projectName}\n`);

  const counts: Record<string, number> = {};
  for (const t of tasks) counts[t.status] = (counts[t.status] ?? 0) + 1;
  console.log(`${BOLD}Backlog summary:${RESET}`);
  for (const [status] of Object.entries(counts)) {
    console.log(`  ${badge(status)}${' '.repeat(Math.max(0, 22 - status.length))}  ${counts[status]}`);
  }

  const byAssignee: Record<string, Record<string, number>> = {};
  for (const t of tasks) {
    byAssignee[t.assignee] ??= {};
    const bucket = byAssignee[t.assignee]!;
    bucket[t.status] = (bucket[t.status] ?? 0) + 1;
  }
  console.log(`\n${BOLD}Per-agent:${RESET}`);
  for (const [assignee, statuses] of Object.entries(byAssignee)) {
    const parts = Object.entries(statuses).map(([s, n]) => `${badge(s)}:${n}`).join('  ');
    console.log(`  ${BOLD}${assignee}${RESET}  ${parts}`);
  }

  console.log('');
}
