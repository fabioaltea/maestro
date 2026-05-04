import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { BacklogManager } from './backlog-manager.js';
import { EventBus } from './event-bus.js';
import type { ProjectPaths } from '../utils/paths.js';
import { agentFilePath } from '../utils/paths.js';
import { PHASE_CONTEXTS } from '../agents/architect/phases/functional.js';
import type { Task } from '../schemas/backlog.js';

export type ArtifactCheck = { ok: boolean; missing: string[]; details?: string };

export function verifyArtifacts(taskId: string, paths: ProjectPaths, manager: BacklogManager): ArtifactCheck {
  const requirePaths = (rels: string[]): ArtifactCheck => {
    const missing = rels.filter((r) => !existsSync(join(paths.root, r)));
    return { ok: missing.length === 0, missing };
  };

  switch (taskId) {
    case 'ARCH-001':
      return requirePaths(['docs/01-functional-analysis.md']);
    case 'ARCH-002':
      return requirePaths(['docs/02-technical-analysis.md']);
    case 'ARCH-003':
      return requirePaths([
        'docs/03-architecture.md',
        'docs/04-data-model.md',
        'docs/05-api-contracts.md',
      ]);
    case 'ARCH-004': {
      const docCheck = requirePaths(['docs/06-backlog.md']);
      if (!docCheck.ok) return docCheck;
      const tasks = manager.getTasks(paths);
      const engCount = tasks.filter((t) => t.id.startsWith('ENG-')).length;
      if (engCount === 0) return { ok: false, missing: ['ENG-* tasks in .maestro/backlog.json'] };
      return { ok: true, missing: [], details: `${engCount} ENG-* tasks in backlog` };
    }
    case 'ARCH-005': {
      const tasks = manager.getTasks(paths);
      const engTasks = tasks.filter((t) => t.id.startsWith('ENG-'));
      const unassigned = engTasks.filter(
        (t) => !t.assignee || t.assignee === 'architect' || t.assignee === 'unassigned',
      );
      const entries = existsSync(paths.agents) ? readdirSync(paths.agents) : [];
      const engineerFiles = entries.filter((n) => n.endsWith('.md') && !n.startsWith('architect'));
      const missing: string[] = [];
      if (engineerFiles.length === 0) missing.push('engineer .md files in .agents/');
      if (unassigned.length > 0) missing.push(`${unassigned.length} ENG-* tasks still unassigned`);
      return { ok: missing.length === 0, missing, details: `${engineerFiles.length} engineer agent(s)` };
    }
    default:
      return { ok: true, missing: [] };
  }
}

export function buildTaskContext(task: Task, paths: ProjectPaths): string {
  const archCtx = PHASE_CONTEXTS[task.id];
  if (archCtx) return archCtx(task, paths);
  return engineerTaskContext(task, paths);
}

function engineerTaskContext(task: Task, paths: ProjectPaths): string {
  const personaFile = agentFilePath(paths, task.assignee);
  const persona = existsSync(personaFile) ? readFileSync(personaFile, 'utf8') : '';
  const conventionsFile = join(paths.agentsBase, 'conventions.md');
  const conventions = existsSync(conventionsFile) ? readFileSync(conventionsFile, 'utf8') : '';

  const docFiles = [
    'docs/01-functional-analysis.md',
    'docs/02-technical-analysis.md',
    'docs/03-architecture.md',
    'docs/04-data-model.md',
    'docs/05-api-contracts.md',
  ];
  const refs = docFiles
    .filter((f) => existsSync(join(paths.root, f)))
    .map((f) => `- ${f}`)
    .join('\n');

  return `# Current task: ${task.id} — ${task.title}

**Assignee:** ${task.assignee} (${task.area}, complexity ${task.complexity})
**Description:** ${task.description}

**Acceptance criteria:**
- ${task.acceptance_criteria.join('\n- ')}

**Required skills:** ${task.required_skills.join(', ') || '(none)'}
**Prerequisites (must be done):** ${task.prerequisites.join(', ') || '(none)'}

## Reference docs in this project (read before coding)
${refs || '(no project docs found)'}

## Persona for this task

${persona || '(no persona file found — fall back to base engineer template)'}

## Project conventions

${conventions || '(no conventions file found)'}

## Task execution protocol

You are running inside a single \`maestro\` autonomous loop. Each task is one
focused unit of work.

1. Read the reference docs listed above (they are the source of truth).
2. Implement the task per its description and acceptance criteria.
3. Use your native tools (Bash, Read, Write, Edit) to modify the codebase.
4. Run tests where applicable.
5. When you believe the acceptance criteria are met, call:
   \`Bash: maestro mark-done ${task.id}\`
6. The output of \`mark-done\` will contain the next task's context. Continue
   the loop until \`maestro next-task\` reports no ready tasks remain.
`;
}

export type PromoteResult = { promoted: string[] };

export function promoteReadyTasks(
  paths: ProjectPaths,
  bus: EventBus,
  manager: BacklogManager,
): PromoteResult {
  const all = manager.getTasks(paths);
  const doneIds = new Set(all.filter((t) => t.status === 'done').map((t) => t.id));
  const promoted: string[] = [];
  for (const t of all) {
    if (t.status === 'pending' && t.prerequisites.every((p) => doneIds.has(p))) {
      manager.updateTask(paths, t.id, { status: 'ready' });
      bus.publish({
        type: 'task.status_changed',
        agent: t.assignee,
        task_id: t.id,
        data: { from: 'pending', to: 'ready' },
      });
      promoted.push(t.id);
    }
  }
  return { promoted };
}
