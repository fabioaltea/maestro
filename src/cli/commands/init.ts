import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, join } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import YAML from 'yaml';
import { MAESTRO_VERSION } from '../../types.js';
import { StateStore } from '../../core/state-store.js';
import { BacklogSchema, type Backlog, type Task } from '../../schemas/backlog.js';
import { ProjectConfigSchema, type ProjectConfig } from '../../schemas/config.js';
import { projectPathsFor, templatesDir, userGlobalConfigFile } from '../../utils/paths.js';
import { writeFileAtomic } from '../../utils/markdown.js';
import { GlobalConfigSchema } from '../../schemas/config.js';

void readdirSync; void statSync; // quiet unused warnings

export type InitOpts = { cwd: string; force: boolean };

// ---------------------------------------------------------------------------
// Prerequisite checks + auto-install
// ---------------------------------------------------------------------------

type CheckResult = { ok: boolean; version?: string };

type Prerequisite = {
  label: string;
  required: boolean;
  check: () => CheckResult;
  // Returns install command argv, or null if auto-install is not possible on this OS.
  installArgv: () => string[] | null;
  installHint: string;
};

function checkTmux(): CheckResult {
  const r = spawnSync('tmux', ['-V'], { stdio: 'pipe' });
  if (r.status !== 0 || r.error) return { ok: false };
  return { ok: true, version: r.stdout.toString().trim() };
}

function checkNode(): CheckResult {
  const [major] = process.versions.node.split('.').map(Number);
  if ((major ?? 0) < 22) return { ok: false, version: process.versions.node };
  return { ok: true, version: process.versions.node };
}

function checkClaudeCLI(): CheckResult {
  const r = spawnSync('claude', ['--version'], { stdio: 'pipe' });
  if (r.status !== 0 || r.error) return { ok: false };
  return { ok: true, version: r.stdout.toString().trim() };
}

function checkAnthropicKey(): CheckResult {
  if (process.env['ANTHROPIC_API_KEY']) return { ok: true };
  const cfgFile = userGlobalConfigFile();
  if (existsSync(cfgFile)) {
    try {
      const cfg = GlobalConfigSchema.parse(YAML.parse(readFileSync(cfgFile, 'utf8')));
      if (cfg.anthropic_api_key) return { ok: true };
    } catch {}
  }
  return { ok: false };
}

/** Detect package manager and return tmux install argv, or null. */
function tmuxInstallArgv(): string[] | null {
  if (process.platform === 'darwin') {
    // Try brew
    const brew = spawnSync('brew', ['--version'], { stdio: 'pipe' });
    if (brew.status === 0 && !brew.error) return ['brew', 'install', 'tmux'];
    // Try MacPorts
    const port = spawnSync('port', ['version'], { stdio: 'pipe' });
    if (port.status === 0 && !port.error) return ['port', 'install', 'tmux'];
    return null;
  }
  if (process.platform === 'linux') {
    const apt = spawnSync('apt-get', ['--version'], { stdio: 'pipe' });
    if (apt.status === 0 && !apt.error) return ['apt-get', 'install', '-y', 'tmux'];
    const dnf = spawnSync('dnf', ['--version'], { stdio: 'pipe' });
    if (dnf.status === 0 && !dnf.error) return ['dnf', 'install', '-y', 'tmux'];
    const pacman = spawnSync('pacman', ['--version'], { stdio: 'pipe' });
    if (pacman.status === 0 && !pacman.error) return ['pacman', '-S', '--noconfirm', 'tmux'];
    return null;
  }
  return null;
}

const PREREQUISITES: Prerequisite[] = [
  {
    label: 'Node.js >=22',
    required: true,
    check: checkNode,
    installArgv: () => null,
    installHint: 'Update Node.js to >=22 using nvm (`nvm install 22`) or from https://nodejs.org',
  },
  {
    label: 'tmux',
    required: true,
    check: checkTmux,
    installArgv: tmuxInstallArgv,
    installHint: 'macOS: `brew install tmux`  |  Ubuntu/Debian: `sudo apt install tmux`',
  },
  {
    // Required for the Architect (Mode A default) and for engineer agents.
    // If using Mode B (anthropic-api), ANTHROPIC_API_KEY is needed instead — validated at run time.
    label: 'claude CLI (Claude Code)',
    required: true,
    check: checkClaudeCLI,
    installArgv: () => null,
    installHint: 'Install Claude Code: https://github.com/anthropics/claude-code\n     (needed for Architect + engineer agents in the default claude-code mode)',
  },
];

function ask(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

async function runPrerequisiteChecks(): Promise<void> {
  console.log('[maestro] checking prerequisites...\n');

  for (const prereq of PREREQUISITES) {
    const result = prereq.check();

    if (result.ok) {
      console.log(`  ✓  ${prereq.label}${result.version ? `  (${result.version})` : ''}`);
      continue;
    }

    // Not OK
    const tag = prereq.required ? '✗' : '⚠';
    const qualifier = prereq.required ? '' : ' (optional — needed for engineer agents)';
    console.log(`  ${tag}  ${prereq.label} not found${qualifier}`);

    const argv = prereq.installArgv();

    if (argv) {
      // Can auto-install — offer to do it
      const cmd = argv.join(' ');
      const answer = await ask(`     Run \`${cmd}\` now? [Y/n] `);
      if (answer === '' || answer === 'y' || answer === 'yes') {
        console.log(`     → running: ${cmd}`);
        try {
          execFileSync(argv[0]!, argv.slice(1), { stdio: 'inherit' });
          const verify = prereq.check();
          if (verify.ok) {
            console.log(`  ✓  ${prereq.label} installed${verify.version ? ` (${verify.version})` : ''}\n`);
            continue;
          } else {
            console.error(`     Installation completed but ${prereq.label} still not detected.`);
          }
        } catch {
          console.error(`     Installation failed. Please install manually:\n     ${prereq.installHint}`);
        }
      } else {
        console.log(`     Skipped. Install manually:\n     ${prereq.installHint}`);
      }
    } else {
      // No auto-install available
      console.log(`     ${prereq.installHint}`);
    }

    if (prereq.required) {
      console.error(`\n[maestro] Cannot initialize: ${prereq.label} is required.\n`);
      process.exit(1);
    }
  }

  console.log('');
}

// ---------------------------------------------------------------------------

export async function runInit(opts: InitOpts): Promise<void> {
  await runPrerequisiteChecks();

  const paths = projectPathsFor(opts.cwd);
  const projectName = basename(opts.cwd);

  if (existsSync(paths.maestroDir)) {
    if (!opts.force) {
      console.error(`[maestro] .maestro already exists at ${paths.maestroDir}. Use --force to reset state.`);
      process.exit(2);
    }
    rmSync(paths.maestroDir, { recursive: true, force: true });
  }

  console.log(`[maestro] initializing project '${projectName}' at ${opts.cwd}`);

  // 1. Directory tree
  mkdirSync(paths.docs, { recursive: true });
  mkdirSync(paths.agents, { recursive: true });            // .claude/agents
  mkdirSync(paths.claudeCommands, { recursive: true });    // .claude/commands
  mkdirSync(paths.agentsBase, { recursive: true });        // .agents/_base
  mkdirSync(paths.agentsArchive, { recursive: true });     // .agents/_archive
  mkdirSync(paths.maestroDir, { recursive: true });
  mkdirSync(paths.sessionsDir, { recursive: true });

  // 2. Templates → user project
  const tpl = templatesDir();
  // Architect agent in claude-native location
  copyTemplate(join(tpl, 'architect.md'), join(paths.agents, 'architect.md'), {
    __CREATED_AT__: new Date().toISOString(),
  });
  // Engineer template kept under .agents/_base for staffing-time generation
  copyTemplate(join(tpl, '_base', 'engineer.md'), join(paths.agentsBase, 'engineer.md'), {
    __CREATED_AT__: new Date().toISOString(),
    __NAME__: 'engineer-template',
    __TITLE__: 'Engineer (Template)',
  });
  copyFileSync(join(tpl, '_base', 'conventions.md'), join(paths.agentsBase, 'conventions.md'));
  copyFileSync(join(tpl, '_base', 'tools.md'), join(paths.agentsBase, 'tools.md'));
  // Slash commands consumed by claude
  const claudeCmdsTpl = join(tpl, '_claude', 'commands');
  for (const file of ['run.md', 'next.md']) {
    const src = join(claudeCmdsTpl, file);
    if (existsSync(src)) copyFileSync(src, join(paths.claudeCommands, file));
  }

  // 3. .gitignore for the user project (append .maestro/ if missing)
  ensureGitignoreEntry(opts.cwd, '.maestro/');

  // 4. version stamp
  writeFileSync(paths.versionFile, `${MAESTRO_VERSION}\n`, 'utf8');

  // 5. project config
  const projectConfig: ProjectConfig = ProjectConfigSchema.parse({
    project_name: projectName,
    maestro_version: MAESTRO_VERSION,
    default_model: 'claude-sonnet-4-6',
    provider_mode: 'claude-code',
    agents: {},
  });
  writeFileAtomic(paths.configFile, YAML.stringify(projectConfig));

  // 6. canonical backlog (5 ARCH-* tasks)
  const backlog: Backlog = BacklogSchema.parse({
    version: MAESTRO_VERSION,
    project_name: projectName,
    tasks: initialArchitectTasks(),
  });
  writeFileAtomic(paths.backlogJson, `${JSON.stringify(backlog, null, 2)}\n`);

  // 7. SQLite init + load tasks
  const store = new StateStore(paths.stateDb);
  try {
    const stmt = store.raw.prepare(`
      INSERT OR REPLACE INTO tasks (
        id, title, description, assignee, status, area, complexity, retry_count,
        prerequisites_json, acceptance_criteria_json, required_skills_json,
        metadata_json, parent_task, created_at, updated_at, started_at, completed_at
      ) VALUES (
        @id, @title, @description, @assignee, @status, @area, @complexity, @retry_count,
        @prerequisites_json, @acceptance_criteria_json, @required_skills_json,
        @metadata_json, @parent_task, @created_at, @updated_at, @started_at, @completed_at
      )
    `);
    const insertMany = store.raw.transaction((tasks: Task[]) => {
      for (const t of tasks) {
        stmt.run({
          id: t.id,
          title: t.title,
          description: t.description,
          assignee: t.assignee,
          status: t.status,
          area: t.area,
          complexity: t.complexity,
          retry_count: t.retry_count,
          prerequisites_json: JSON.stringify(t.prerequisites),
          acceptance_criteria_json: JSON.stringify(t.acceptance_criteria),
          required_skills_json: JSON.stringify(t.required_skills),
          metadata_json: JSON.stringify(t.metadata),
          parent_task: t.parent_task ?? null,
          created_at: t.created_at ?? null,
          updated_at: t.updated_at ?? null,
          started_at: t.started_at ?? null,
          completed_at: t.completed_at ?? null,
        });
      }
    });
    insertMany(backlog.tasks);
  } finally {
    store.close();
  }

  // 8. empty events.log
  if (!existsSync(paths.eventsLog)) writeFileSync(paths.eventsLog, '', 'utf8');

  // 9. friendly summary
  console.log(`
[maestro] init complete.

  ${rel(opts.cwd, paths.docs)}/                  (project brain — versioned)
  ${rel(opts.cwd, paths.agents)}/                (agent personas — versioned)
    architect.md
    _base/{engineer,conventions,tools}.md
  ${rel(opts.cwd, paths.maestroDir)}/                (runtime state — gitignored)
    config.yaml, state.db, backlog.json, events.log

Next:
  maestro backlog        # see initial ARCH-* tasks
  maestro run            # start ARCH-001 (Functional Analysis) — requires step 10+
`);
}

function rel(root: string, p: string): string {
  return p.startsWith(root + '/') ? p.slice(root.length + 1) : p;
}

function copyTemplate(src: string, dst: string, replacements: Record<string, string>): void {
  let content = readFileSync(src, 'utf8');
  for (const [k, v] of Object.entries(replacements)) {
    content = content.split(k).join(v);
  }
  writeFileSync(dst, content, 'utf8');
}

function ensureGitignoreEntry(root: string, entry: string): void {
  const gi = join(root, '.gitignore');
  let body = '';
  if (existsSync(gi)) {
    body = readFileSync(gi, 'utf8');
    if (body.split('\n').some((l) => l.trim() === entry)) return;
    if (!body.endsWith('\n')) body += '\n';
  }
  writeFileSync(gi, `${body}${entry}\n`, 'utf8');
}

function initialArchitectTasks(): Task[] {
  const now = new Date().toISOString();
  const baseAcc = (doc: string) => [`${doc} exists and is approved by user`];
  const t = (
    id: string,
    title: string,
    description: string,
    prereq: string[],
    acc: string[],
    status: 'ready' | 'pending',
  ): Task => ({
    id,
    title,
    description,
    assignee: 'architect',
    status,
    prerequisites: prereq,
    acceptance_criteria: acc,
    required_skills: ['architect-grade'],
    area: 'meta',
    complexity: 'M',
    retry_count: 0,
    metadata: {},
    created_at: now,
    updated_at: now,
  });
  return [
    t(
      'ARCH-001',
      'Functional Analysis',
      'Discovery conversation with the user. Capture target users, primary use cases, value proposition, critical flows, edge cases, and any compliance constraints. Produce docs/01-functional-analysis.md and request approval.',
      [],
      baseAcc('docs/01-functional-analysis.md'),
      'ready',
    ),
    t(
      'ARCH-002',
      'Technical Analysis',
      'Capture stack preferences, hosting/deployment, auth, persistence, integrations, NFRs, team and budget. Produce docs/02-technical-analysis.md and request approval.',
      ['ARCH-001'],
      baseAcc('docs/02-technical-analysis.md'),
      'pending',
    ),
    t(
      'ARCH-003',
      'Architecture Design',
      'Draft architecture, data model, and API contracts. Mostly autonomous; ask the user only on key trade-offs. Produce docs/03-architecture.md, docs/04-data-model.md, docs/05-api-contracts.md.',
      ['ARCH-002'],
      [
        'docs/03-architecture.md exists and is approved by user',
        'docs/04-data-model.md exists',
        'docs/05-api-contracts.md exists',
      ],
      'pending',
    ),
    t(
      'ARCH-004',
      'Planning & Backlog',
      'Decompose the architecture into ENG-* tasks with prerequisites, acceptance criteria, required_skills, complexity, and area. Update .maestro/backlog.json and produce docs/06-backlog.md. Light gate at the end.',
      ['ARCH-003'],
      [
        'docs/06-backlog.md exists',
        '.maestro/backlog.json contains ENG-* tasks',
      ],
      'pending',
    ),
    t(
      'ARCH-005',
      'Staffing',
      'Cluster ENG-* tasks by required-skills overlap. Generate engineer .md files in .agents/. Assign each task to an engineer. Pick default model per agent based on task complexity. Light gate at the end.',
      ['ARCH-004'],
      [
        'engineer .md files exist in .agents/',
        'every ENG-* task has an assignee that is not "architect"',
      ],
      'pending',
    ),
  ];
}

// quiet unused-import warnings when readdirSync/statSync are not yet used elsewhere
void readdirSync;
void statSync;
