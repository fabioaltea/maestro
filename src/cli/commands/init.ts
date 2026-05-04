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
import { BacklogSchema, type Backlog, type Task } from '../../schemas/backlog.js';
import { ProjectConfigSchema, type ProjectConfig } from '../../schemas/config.js';
import { projectPathsFor, templatesDir, userGlobalConfigFile, agentFileName, packageRoot, type Provider } from '../../utils/paths.js';
import { runtimeFilePath } from '../../utils/vscode-bridge.js';
import { writeFileAtomic } from '../../utils/markdown.js';
import { GlobalConfigSchema } from '../../schemas/config.js';
import { log } from '../../utils/logger.js';

void readdirSync; void statSync; // quiet unused warnings

export type InitOpts = { cwd: string; force: boolean; provider: Provider };

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

// Augment PATH with common Homebrew/system dirs so probes work without shell:true.
const PROBE_ENV = {
  ...process.env,
  PATH: `/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/bin:/bin:${process.env.PATH ?? ''}`,
};
const SPAWN_OPTS = { stdio: 'pipe' as const, env: PROBE_ENV };

function checkTmux(): CheckResult {
  const r = spawnSync('tmux', ['-V'], SPAWN_OPTS);
  if (r.status !== 0 || r.error) return { ok: false };
  return { ok: true, version: r.stdout.toString().trim() };
}

function checkNode(): CheckResult {
  const [major] = process.versions.node.split('.').map(Number);
  if ((major ?? 0) < 22) return { ok: false, version: process.versions.node };
  return { ok: true, version: process.versions.node };
}

function checkClaudeCLI(): CheckResult {
  const r = spawnSync('claude', ['--version'], SPAWN_OPTS);
  if (r.status !== 0 || r.error) return { ok: false };
  return { ok: true, version: r.stdout.toString().trim() };
}

function checkCopilotCLI(): CheckResult {
  const r = spawnSync('copilot', ['--version'], SPAWN_OPTS);
  if (r.status !== 0 || r.error) return { ok: false };
  return { ok: true, version: r.stdout.toString().trim() };
}

function checkCodexCLI(): CheckResult {
  const r = spawnSync('codex', ['--version'], SPAWN_OPTS);
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
    const brew = spawnSync('brew', ['--version'], SPAWN_OPTS);
    if (brew.status === 0 && !brew.error) return ['brew', 'install', 'tmux'];
    const port = spawnSync('port', ['version'], SPAWN_OPTS);
    if (port.status === 0 && !port.error) return ['port', 'install', 'tmux'];
    return null;
  }
  if (process.platform === 'linux') {
    const apt = spawnSync('apt-get', ['--version'], SPAWN_OPTS);
    if (apt.status === 0 && !apt.error) return ['apt-get', 'install', '-y', 'tmux'];
    const dnf = spawnSync('dnf', ['--version'], SPAWN_OPTS);
    if (dnf.status === 0 && !dnf.error) return ['dnf', 'install', '-y', 'tmux'];
    const pacman = spawnSync('pacman', ['--version'], SPAWN_OPTS);
    if (pacman.status === 0 && !pacman.error) return ['pacman', '-S', '--noconfirm', 'tmux'];
    return null;
  }
  return null;
}

/** Prerequisites always required regardless of provider. */
const PREREQUISITES_COMMON: Prerequisite[] = [
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
];

/** Prerequisites only required when using the claude provider. */
const PREREQUISITES_CLAUDE: Prerequisite[] = [
  {
    label: 'claude CLI (Claude Code)',
    required: true,
    check: checkClaudeCLI,
    installArgv: () => null,
    installHint: 'Install Claude Code: https://github.com/anthropics/claude-code\n     (needed for Architect + engineer agents in the claude-code mode)',
  },
];

/** Prerequisites only required when using the copilot provider. */
const PREREQUISITES_COPILOT: Prerequisite[] = [
  {
    label: 'copilot CLI (GitHub Copilot)',
    required: true,
    check: checkCopilotCLI,
    installArgv: () => null,
    installHint: 'Install GitHub Copilot CLI: https://github.com/github/copilot-cli\n     (`npm install -g @githubnext/github-copilot-cli` or see the repo for details)',
  },
];

/** Prerequisites only required when using the codex provider. */
const PREREQUISITES_CODEX: Prerequisite[] = [
  {
    label: 'codex CLI (OpenAI Codex)',
    required: true,
    check: checkCodexCLI,
    installArgv: () => null,
    installHint: 'Install OpenAI Codex CLI: https://github.com/openai/codex\n     (`npm install -g @openai/codex` or see the repo for details)',
  },
];

function prerequisitesFor(provider: Provider): Prerequisite[] {
  switch (provider) {
    case 'claude':  return [...PREREQUISITES_COMMON, ...PREREQUISITES_CLAUDE];
    case 'copilot': return [...PREREQUISITES_COMMON, ...PREREQUISITES_COPILOT];
    case 'codex':   return [...PREREQUISITES_COMMON, ...PREREQUISITES_CODEX];
  }
}

function ask(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

async function runPrerequisiteChecks(provider: Provider): Promise<void> {
  log.info('checking prerequisites...\n');

  for (const prereq of prerequisitesFor(provider)) {
    const result = prereq.check();

    if (result.ok) {
      log.check(prereq.label, true, result.version);
      continue;
    }

    const qualifier = prereq.required ? undefined : 'optional — needed for engineer agents';
    if (prereq.required) {
      log.check(`${prereq.label} not found`, false, qualifier);
    } else {
      log.warn_check(`${prereq.label} not found`, qualifier);
    }

    const argv = prereq.installArgv();

    if (argv) {
      const cmd = argv.join(' ');
      const answer = await ask(`     Run \`${cmd}\` now? [Y/n] `);
      if (answer === '' || answer === 'y' || answer === 'yes') {
        log.step(`running: ${cmd}`);
        try {
          execFileSync(argv[0]!, argv.slice(1), { stdio: 'inherit', env: PROBE_ENV });
          const verify = prereq.check();
          if (verify.ok) {
            log.check(`${prereq.label} installed`, true, verify.version);
            continue;
          } else {
            log.warn(`installation completed but ${prereq.label} still not detected`);
          }
        } catch {
          log.error(`installation failed — install manually:\n     ${prereq.installHint}`);
        }
      } else {
        log.step(`skipped — install manually:\n     ${prereq.installHint}`);
      }
    } else {
      log.step(prereq.installHint);
    }

    if (prereq.required) {
      log.error(`cannot initialize: ${prereq.label} is required`);
      process.exit(1);
    }
  }

  console.log('');
}

// ---------------------------------------------------------------------------

/** Maps Provider → provider_mode value stored in config.yaml. */
const PROVIDER_MODE: Record<Provider, string> = {
  claude:  'claude-code',
  copilot: 'copilot',
  codex:   'codex',
};

/** Maps Provider → default model. */
const PROVIDER_DEFAULT_MODEL: Record<Provider, string> = {
  claude:  'claude-sonnet-4-6',
  copilot: 'gpt-4o',
  codex:   'codex',
};

/** Maps Provider → architect template path relative to templatesDir(). */
const PROVIDER_ARCHITECT_TEMPLATE: Record<Provider, string> = {
  claude:  'architect.md',
  copilot: join('_copilot', 'architect.md'),
  codex:   join('_codex', 'architect.md'),
};

export async function runInit(opts: InitOpts): Promise<void> {
  const { provider } = opts;
  await runPrerequisiteChecks(provider);

  const paths = projectPathsFor(opts.cwd, provider);
  const projectName = basename(opts.cwd);

  if (existsSync(paths.maestroDir)) {
    if (!opts.force) {
      log.error(`.maestro already exists at ${paths.maestroDir} — use --force to reset`);
      process.exit(2);
    }
    rmSync(paths.maestroDir, { recursive: true, force: true });
  }

  log.info(`initializing '${projectName}'  (provider: ${provider})`);

  // 1. Directory tree
  mkdirSync(paths.docs, { recursive: true });
  mkdirSync(paths.agents, { recursive: true });
  mkdirSync(paths.agentsBase, { recursive: true });        // .agents/_base
  mkdirSync(paths.agentsArchive, { recursive: true });     // .agents/_archive
  mkdirSync(paths.maestroDir, { recursive: true });
  mkdirSync(paths.sessionsDir, { recursive: true });
  // Slash commands directory — only relevant for the claude provider
  if (provider === 'claude') {
    mkdirSync(paths.claudeCommands, { recursive: true });
  }

  // 2. Templates → user project
  const tpl = templatesDir();
  // Architect agent in the provider-native location
  copyTemplate(join(tpl, PROVIDER_ARCHITECT_TEMPLATE[provider]), join(paths.agents, agentFileName(provider, 'architect')), {
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
  // Slash commands — only for the claude provider
  if (provider === 'claude') {
    const claudeCmdsTpl = join(tpl, '_claude', 'commands');
    for (const file of ['run.md', 'next.md']) {
      const src = join(claudeCmdsTpl, file);
      if (existsSync(src)) copyFileSync(src, join(paths.claudeCommands, file));
    }
  }

  // 3. .gitignore for the user project (append .maestro/ if missing)
  ensureGitignoreEntry(opts.cwd, '.maestro/');

  // 4. version stamp
  writeFileSync(paths.versionFile, `${MAESTRO_VERSION}\n`, 'utf8');

  // 5. project config
  const projectConfig: ProjectConfig = ProjectConfigSchema.parse({
    project_name: projectName,
    maestro_version: MAESTRO_VERSION,
    default_model: PROVIDER_DEFAULT_MODEL[provider],
    provider_mode: PROVIDER_MODE[provider],
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

  // 7. empty events.log
  if (!existsSync(paths.eventsLog)) writeFileSync(paths.eventsLog, '', 'utf8');

  // 8b. seed .runtime.json so CLI can route to VSCode extension immediately
  //     (extension overwrites this with real PID on activate)
  writeFileSync(runtimeFilePath(paths.maestroDir), JSON.stringify({ workspace: opts.cwd }), 'utf8');

  // 8c. install VSCode-family extension if any editor CLI is available
  installVscodeExtension();

  // 9. friendly summary
  log.ok(`init complete  (provider: ${provider})\n`);
  console.log(
    `  ${rel(opts.cwd, paths.docs)}/                  (project brain — versioned)\n` +
    `  ${rel(opts.cwd, paths.agents)}/                (agent personas — versioned)\n` +
    `    architect.md\n` +
    `    _base/{engineer,conventions,tools}.md\n` +
    `  ${rel(opts.cwd, paths.maestroDir)}/                (runtime state — gitignored)\n` +
    `    config.yaml, backlog.json, events.log\n` +
    `\nNext:\n` +
    `  maestro backlog        # see initial ARCH-* tasks\n` +
    `  maestro run            # start ARCH-001 (Functional Analysis)\n`,
  );
}

/** Locate the bundled .vsix inside the npm package, or return null. */
function findBundledVsix(): string | null {
  const dir = join(packageRoot(), 'vscode-extension', 'dist');
  if (!existsSync(dir)) return null;
  try {
    const entries = readdirSync(dir).filter((f) => f.endsWith('.vsix'));
    if (entries.length === 0) return null;
    entries.sort();
    return join(dir, entries[entries.length - 1]!);
  } catch {
    return null;
  }
}

/** Try installing the bundled .vsix into every detected VSCode-family editor. */
function installVscodeExtension(): void {
  const vsix = findBundledVsix();
  if (!vsix) return;
  const editors = ['code', 'cursor', 'windsurf', 'codium'];
  const installed: string[] = [];
  for (const cli of editors) {
    const probe = spawnSync(cli, ['--version'], SPAWN_OPTS);
    if (probe.status !== 0 || probe.error) continue;
    const r = spawnSync(cli, ['--install-extension', vsix, '--force'], SPAWN_OPTS);
    if (r.status === 0 && !r.error) installed.push(cli);
  }
  if (installed.length > 0) {
    log.ok(`VSCode extension installed in: ${installed.join(', ')}`);
  }
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
