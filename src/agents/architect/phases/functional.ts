import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Task } from '../../../schemas/backlog.js';
import { templatesDir, type ProjectPaths } from '../../../utils/paths.js';

export type PhaseContextFn = (task: Task, paths: ProjectPaths) => string;

const TASK_RUN_PROTOCOL = `
## Task execution protocol (read carefully)

You are running inside a single \`maestro run <task-id>\` invocation. Each invocation
handles **exactly one task** from \`.maestro/backlog.json\`. You are not expected to
chain phases yourself; maestro will mark this task complete after you exit, then
the user will run the next phase.

**First turn behavior — IMPORTANT**:
The user's first message will be a meaningless trigger word like "begin". **Ignore
its content**. Treat the first turn as your opportunity to introduce yourself and
start the phase: greet the user, briefly explain what this phase covers and what
you'll produce, then ask the first discovery question (or, for autonomous phases,
announce what you're about to draft and proceed).

Rules for this session:
1. Focus only on the current task described below. Do **not** start the next phase.
2. Read prior phase outputs from \`docs/\` if present — they are your source of truth.
3. Produce all required artifacts (files listed in "Acceptance criteria"). Write them
   to disk before ending.
4. When the work is complete and the user has approved (for gated phases), summarize
   what you produced in one short paragraph and **exit** (the user will close the
   claude session, or you can announce you are done and stop responding).
5. Maestro will then verify the artifacts on disk and update the backlog.
`;

function priorDocsBlock(paths: ProjectPaths, files: string[]): string {
  const found: string[] = [];
  for (const rel of files) {
    const full = join(paths.root, rel);
    if (existsSync(full)) {
      const body = readFileSync(full, 'utf8');
      found.push(`\n### ${rel}\n\n${body}`);
    }
  }
  if (found.length === 0) return '';
  return `\n## Prior phase outputs (your source of truth)\n${found.join('\n')}\n`;
}

function commonHeader(task: Task): string {
  return `# Current task: ${task.id} — ${task.title}

**Description:** ${task.description}

**Acceptance criteria:**
- ${task.acceptance_criteria.join('\n- ')}
`;
}

export const functionalAnalysisContext: PhaseContextFn = (task, _paths) => {
  const welcome = readFileSync(join(templatesDir(), 'welcome-arch-001.md'), 'utf8');
  return `${commonHeader(task)}
${TASK_RUN_PROTOCOL}

## Phase guide — Functional Analysis (ARCH-001)

Run a discovery conversation. Internally maintain (do not show) a checklist:
- Target users / personas
- Primary use cases
- Core value proposition
- Critical user flows
- Edge cases the user cares about
- Compliance / regulatory constraints

Ask one or two focused questions at a time. Maintain an Assumptions list with
stable IDs (FA-A-1, FA-A-2, ...). Propose alternatives proactively when the user
is vague.

When the checklist is sufficiently covered:
1. Write \`docs/01-functional-analysis.md\` with sections:
   Overview, Users, Use cases, Value proposition, Critical flows, Edge cases,
   Constraints, Assumptions.
2. Show the user a short summary and ask explicitly: "approve" or "revise <feedback>".
3. On revise, edit the doc and re-ask.
4. On approve, announce you are done and stop. Maestro marks ARCH-001 complete.

## Welcome message (send first turn, verbatim or close)

${welcome}
`;
};

export const technicalAnalysisContext: PhaseContextFn = (task, paths) => `${commonHeader(task)}
${TASK_RUN_PROTOCOL}
${priorDocsBlock(paths, ['docs/01-functional-analysis.md'])}
## Phase guide — Technical Analysis (ARCH-002)

Conversational. Cover (one/two questions at a time):
- Stack preferences / constraints (languages, frameworks)
- Hosting / deployment target
- Auth approach
- Persistence
- External integrations
- Non-functional requirements (perf, scale, security, availability)
- Team that will maintain
- Budget constraints

If functional analysis already hints at technical choices, pick them up and ask only
about gaps. Maintain Assumptions with IDs (TA-A-1, ...).

When complete:
1. Write \`docs/02-technical-analysis.md\` with sections matching the bullets above
   plus an Assumptions section.
2. Summarize, ask "approve" or "revise <feedback>".
3. On approve, announce done and stop.
`;

export const architectureDesignContext: PhaseContextFn = (task, paths) => `${commonHeader(task)}
${TASK_RUN_PROTOCOL}
${priorDocsBlock(paths, ['docs/01-functional-analysis.md', 'docs/02-technical-analysis.md'])}
## Phase guide — Architecture Design (ARCH-003)

Mostly autonomous. Draft:
- **Architecture** (\`docs/03-architecture.md\`): components, boundaries, communication
  patterns, deployment topology.
- **Data model** (\`docs/04-data-model.md\`): entities, relationships, key fields,
  storage choices.
- **API contracts** (\`docs/05-api-contracts.md\`): endpoints/messages, schemas,
  auth, error model.

Only ask the user on **key design decisions** with material trade-offs (e.g. monolith
vs services, sync vs async, SQL vs NoSQL when not already pinned). For each such
question, present 2-3 options with pros/cons and a recommendation.

When all three docs are written, summarize and ask "approve" or "revise <feedback>".
On approve, announce done and stop.
`;

export const planningContext: PhaseContextFn = (task, paths) => `${commonHeader(task)}
${TASK_RUN_PROTOCOL}
${priorDocsBlock(paths, [
  'docs/01-functional-analysis.md',
  'docs/02-technical-analysis.md',
  'docs/03-architecture.md',
  'docs/04-data-model.md',
  'docs/05-api-contracts.md',
])}
## Phase guide — Planning & Backlog (ARCH-004)

Decompose the architecture into ENG-* tasks. Each task must have:
- \`id\` — \`ENG-NNN\` (sequential, zero-padded to 3 digits)
- \`title\` — short imperative
- \`description\` — concrete scope
- \`acceptance_criteria\` — testable bullets
- \`prerequisites\` — array of other ENG-* / ARCH-* ids
- \`required_skills\` — tags from the controlled vocabulary (see below)
- \`area\` — one of: frontend | backend | data | infra | test | docs | meta
- \`complexity\` — S | M | L
- \`assignee\` — leave as \`"unassigned"\` (staffing happens in ARCH-005)
- \`status\` — \`"pending"\` (will be promoted by scheduler)

Skill vocabulary (extensible): typescript, javascript, python, go, rust, java,
react, vue, nextjs, tailwind, shadcn, fastapi, django, express, nestjs, rest, graphql,
postgres, mysql, sqlite, mongodb, redis, docker, kubernetes, terraform, aws, gcp,
azure, ci-cd, github-actions, unit-test, integration-test, e2e-test, playwright,
jest, pytest, security, performance, i18n, documentation, architect-grade.

Output:
1. Add all ENG-* tasks to \`.maestro/backlog.json\` (use the same JSON shape as the
   existing ARCH-* tasks). Read current backlog first, then write the merged result.
2. Write \`docs/06-backlog.md\` with a human-readable table grouped by area.
3. Light gate: summarize counts per area and complexity, ask "approve" or "revise".
`;

export const staffingContext: PhaseContextFn = (task, paths) => `${commonHeader(task)}
${TASK_RUN_PROTOCOL}
${priorDocsBlock(paths, ['docs/06-backlog.md'])}
## Phase guide — Staffing (ARCH-005)

1. Load all ENG-* tasks from \`.maestro/backlog.json\`.
2. Cluster by required-skills overlap. Greedy: sort tasks by skill set, group
   consecutive tasks sharing >=70% of their tags.
3. Name each cluster (e.g. \`frontend-react\`, \`backend-fastapi\`, \`dba-postgres\`).
4. For each cluster generate \`.agents/<cluster>.md\` based on
   \`.agents/_base/engineer.md\` template. Fill: skills, conventions snippet,
   tool preferences, identity, responsibilities.
5. Pick model per agent:
   - mostly L tasks or \`architect-grade\` skills → \`claude-opus-4-7\`
   - mostly S tasks → \`claude-haiku-4-5\`
   - otherwise → \`claude-sonnet-4-6\`
6. Update each ENG-* task's \`assignee\` field in \`.maestro/backlog.json\` to the
   cluster name.
7. Light gate: list generated agents with model + task count. Ask "approve" or
   "revise". Tell the user they can edit \`.agents/*.md\` directly before approving.

No interactive wizard. After approve, announce done and stop.
`;

export const PHASE_CONTEXTS: Record<string, PhaseContextFn> = {
  'ARCH-001': functionalAnalysisContext,
  'ARCH-002': technicalAnalysisContext,
  'ARCH-003': architectureDesignContext,
  'ARCH-004': planningContext,
  'ARCH-005': staffingContext,
};
