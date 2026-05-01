import { findProjectRoot, projectPathsFor } from '../../utils/paths.js';
import { StateStore } from '../../core/state-store.js';
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

function rowFromDb(row: Record<string, unknown>): Task {
  return {
    id: row['id'] as string,
    title: row['title'] as string,
    description: row['description'] as string,
    assignee: row['assignee'] as string,
    status: row['status'] as Task['status'],
    area: (row['area'] as string) ?? 'meta',
    complexity: (row['complexity'] as Task['complexity']) ?? 'M',
    retry_count: (row['retry_count'] as number) ?? 0,
    prerequisites: JSON.parse((row['prerequisites_json'] as string) ?? '[]'),
    acceptance_criteria: JSON.parse((row['acceptance_criteria_json'] as string) ?? '[]'),
    required_skills: JSON.parse((row['required_skills_json'] as string) ?? '[]'),
    metadata: JSON.parse((row['metadata_json'] as string) ?? '{}'),
    parent_task: row['parent_task'] as string | undefined,
    created_at: row['created_at'] as string | undefined,
    updated_at: row['updated_at'] as string | undefined,
    started_at: row['started_at'] as string | undefined,
    completed_at: row['completed_at'] as string | undefined,
  };
}

export async function runBacklog(taskId?: string): Promise<void> {
  const root = findProjectRoot();
  if (!root) {
    console.error('[maestro] Not in a maestro project. Run `maestro init` first.');
    process.exit(1);
  }
  const paths = projectPathsFor(root);
  const store = new StateStore(paths.stateDb);

  try {
    if (taskId) {
      const row = store.raw.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as Record<string, unknown> | undefined;
      if (!row) {
        console.error(`[maestro] Task '${taskId}' not found.`);
        process.exit(1);
      }
      const t = rowFromDb(row);
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
      return;
    }

    const rows = store.raw.prepare('SELECT * FROM tasks').all() as Record<string, unknown>[];
    const tasks = rows.map(rowFromDb);
    tasks.sort((a, b) => statusRank(a.status) - statusRank(b.status));

    console.log('');
    for (const t of tasks) {
      const id = t.id.padEnd(10);
      const status = badge(t.status);
      const assignee = DIM + t.assignee + RESET;
      console.log(`  ${BOLD}${id}${RESET}  ${status.padEnd(30)}  ${assignee.padEnd(25)}  ${t.title}`);
    }
    console.log('');
  } finally {
    store.close();
  }
}
