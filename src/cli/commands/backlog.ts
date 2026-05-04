import { findProjectRoot, projectPathsFor } from '../../utils/paths.js';
import { BacklogManager } from '../../core/backlog-manager.js';
import type { Task } from '../../schemas/backlog.js';

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

const STATUS_ORDER = ['ready', 'in_progress', 'awaiting_approval', 'blocked', 'blocked_needs_user', 'pending', 'failed', 'done'];

function statusRank(s: string): number {
  const idx = STATUS_ORDER.indexOf(s);
  return idx === -1 ? STATUS_ORDER.length : idx;
}

export async function runBacklog(taskId?: string): Promise<void> {
  const root = findProjectRoot();
  if (!root) {
    console.error('[maestro] Not in a maestro project. Run `maestro init` first.');
    process.exit(1);
  }
  const paths = projectPathsFor(root);
  const manager = new BacklogManager();

  if (taskId) {
    const t = manager.getTask(paths, taskId);
    if (!t) {
      console.error(`[maestro] Task '${taskId}' not found.`);
      process.exit(1);
    }
    printTaskDetail(t);
    return;
  }

  const tasks = manager.getTasks(paths);
  tasks.sort((a, b) => statusRank(a.status) - statusRank(b.status));

  console.log('');
  for (const t of tasks) {
    const id = t.id.padEnd(10);
    const status = badge(t.status);
    const assignee = DIM + t.assignee + RESET;
    console.log(`  ${BOLD}${id}${RESET}  ${status.padEnd(30)}  ${assignee.padEnd(25)}  ${t.title}`);
  }
  console.log('');
}

function printTaskDetail(t: Task): void {
  console.log(`\n${BOLD}${t.id}${RESET}  ${badge(t.status)}`);
  console.log(`${BOLD}Title:${RESET}       ${t.title}`);
  console.log(`${BOLD}Assignee:${RESET}    ${t.assignee}`);
  console.log(`${BOLD}Area:${RESET}        ${t.area}`);
  console.log(`${BOLD}Complexity:${RESET}  ${t.complexity}`);
  console.log(`${BOLD}Description:${RESET}\n  ${t.description}`);
  if (t.prerequisites.length) console.log(`${BOLD}Prerequisites:${RESET} ${t.prerequisites.join(', ')}`);
  if (t.acceptance_criteria.length) {
    console.log(`${BOLD}Acceptance criteria:${RESET}`);
    for (const ac of t.acceptance_criteria) console.log(`  - ${ac}`);
  }
  if (t.required_skills.length) console.log(`${BOLD}Required skills:${RESET} ${t.required_skills.join(', ')}`);
  if (t.created_at) console.log(`${BOLD}Created:${RESET}     ${t.created_at}`);
  if (t.updated_at) console.log(`${BOLD}Updated:${RESET}     ${t.updated_at}`);
  console.log('');
}
