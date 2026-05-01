import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import YAML from 'yaml';
import { findProjectRoot, projectPathsFor } from '../../utils/paths.js';
import { ProjectConfigSchema } from '../../schemas/config.js';

const DEFAULT_MODEL = 'claude-opus-4-7';

const LOOP_PROTOCOL = `
You are operating inside a Maestro autonomous loop.

**Bootstrap (do this first, on your very first turn):**
1. Run \`Bash: maestro next-task\`. Its stdout contains the id and full execution
   context for the next ready task in the backlog.
2. Read it carefully, then execute the task following the protocol embedded inside.

**On task completion:**
1. Verify acceptance criteria yourself.
2. Run \`Bash: maestro mark-done <TASK_ID>\`.
3. The output of \`mark-done\` either:
   - Begins with "DONE — all tasks completed" → stop and tell the user the project
     plan is fully executed.
   - Begins with "NO_READY_TASKS" → stop and report what's blocking.
   - Contains a "# next-task: <ID>" section → that is your new task; execute it.
4. Loop until terminal state.

**Pauses for user gates:**
For Architect phases (ARCH-001..005) you must pause before \`mark-done\` and ask
the user "approve" or "revise <feedback>". Only call \`mark-done\` after approval.
On revise, edit the artifact and ask again.

**Failure handling:**
If a task is impossible, run \`Bash: maestro mark-failed <TASK_ID> "<reason>"\`
(when implemented) or describe the blocker to the user and stop.

Never invent task IDs or skip phases. Always rely on \`maestro next-task\` and
\`maestro mark-done\` for state transitions.
`;

function resolveModel(configFile: string): string {
  if (existsSync(configFile)) {
    try {
      const cfg = ProjectConfigSchema.parse(YAML.parse(readFileSync(configFile, 'utf8')));
      const arch = cfg.agents['architect'];
      if (arch?.model) return arch.model;
      if (cfg.default_model) return cfg.default_model;
    } catch {}
  }
  return DEFAULT_MODEL;
}

export async function runStart(): Promise<void> {
  const root = findProjectRoot();
  if (!root) {
    console.error('[maestro] Not in a maestro project. Run `maestro init` first.');
    process.exit(1);
  }
  const paths = projectPathsFor(root);
  const personaFile = join(paths.agents, 'architect.md');
  if (!existsSync(personaFile)) {
    console.error(`[maestro] architect.md not found at ${personaFile}.`);
    process.exit(1);
  }
  const persona = readFileSync(personaFile, 'utf8');
  const systemPrompt = `${persona}\n\n---\n${LOOP_PROTOCOL}`;
  const model = resolveModel(paths.configFile);

  const probe = spawnSync('claude', ['--help'], { stdio: 'pipe' });
  if (probe.error && (probe.error as NodeJS.ErrnoException).code === 'ENOENT') {
    console.error('[maestro] claude CLI not found on PATH. Install Claude Code first.');
    process.exit(1);
  }
  const help = `${probe.stdout?.toString() ?? ''}\n${probe.stderr?.toString() ?? ''}`;
  const supports = (flag: string) => help.includes(flag);

  const args: string[] = [];
  if (supports('--model')) args.push('--model', model);
  if (supports('--append-system-prompt')) {
    args.push('--append-system-prompt', systemPrompt);
  }

  console.log(`[maestro] Starting autonomous loop in ${root}`);
  console.log(`[maestro] Model: ${model}`);
  console.log(`[maestro] Type 'go' (or anything) to start. Architect will run \`maestro next-task\` on its first turn.\n`);

  const r = spawnSync('claude', args, { stdio: 'inherit', cwd: root });
  if (r.error) {
    console.error('[maestro] failed to launch claude:', r.error.message);
    process.exit(1);
  }
}
