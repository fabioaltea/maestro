import { createInterface } from 'node:readline';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import Anthropic from '@anthropic-ai/sdk';
import { projectPathsFor, agentFilePath } from '../../utils/paths.js';
import { StateStore } from '../../core/state-store.js';
import { EventBus } from '../../core/event-bus.js';
import { BacklogManager } from '../../core/backlog-manager.js';
import { AnthropicProvider } from '../../llm/anthropic.js';
import { recordCall } from '../../llm/cost-tracker.js';
import { ARCHITECT_TOOLS, handleArchitectTool, isGateResult } from './tools.js';
import type { ToolContext } from './tools.js';
import { PHASE_CONTEXTS } from './phases/functional.js';
import type { ProviderMode } from '../../schemas/agent-frontmatter.js';
import type { Task } from '../../schemas/backlog.js';
import type { ProjectPaths } from '../../utils/paths.js';
import { ProjectConfigSchema } from '../../schemas/config.js';
import YAML from 'yaml';

const DEFAULT_MODEL = 'claude-opus-4-7';

function makePrompt(q: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl.question(q, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

function resolveProviderMode(paths: ProjectPaths): ProviderMode {
  if (existsSync(paths.configFile)) {
    try {
      const cfg = ProjectConfigSchema.parse(YAML.parse(readFileSync(paths.configFile, 'utf8')));
      return cfg.provider_mode ?? 'claude-code';
    } catch {}
  }
  return 'claude-code';
}

function resolveModel(paths: ProjectPaths, agentName: string): string {
  if (existsSync(paths.configFile)) {
    try {
      const cfg = ProjectConfigSchema.parse(YAML.parse(readFileSync(paths.configFile, 'utf8')));
      const override = cfg.agents[agentName];
      if (override?.model) return override.model;
      if (cfg.default_model) return cfg.default_model;
    } catch {}
  }
  return DEFAULT_MODEL;
}

export async function runArchitectTask(projectRoot: string, taskId: string): Promise<void> {
  const paths = projectPathsFor(projectRoot);
  const store = new StateStore(paths.stateDb);
  const bus = new EventBus(paths.eventsLog, store);
  const manager = new BacklogManager();

  const task = manager.getTask(paths, taskId);
  if (!task) {
    console.error(`[maestro] Task ${taskId} not found in backlog`);
    store.close();
    process.exit(1);
  }
  if (task.assignee !== 'architect') {
    console.error(`[maestro] Task ${taskId} is assigned to '${task.assignee}', not 'architect'`);
    store.close();
    process.exit(1);
  }
  if (task.status !== 'ready' && task.status !== 'in_progress') {
    console.error(`[maestro] Task ${taskId} has status '${task.status}'; expected 'ready' or 'in_progress'`);
    store.close();
    process.exit(1);
  }

  // Mark as in_progress
  manager.updateTask(paths, store, taskId, {
    status: 'in_progress',
    started_at: new Date().toISOString(),
  });
  bus.publish({ type: 'task.started', agent: 'architect', task_id: taskId, data: {} });

  const agentFile = agentFilePath(paths, 'architect');
  if (!existsSync(agentFile)) {
    store.close();
    throw new Error(`architect.md not found at ${agentFile}`);
  }
  const systemPromptContent = readFileSync(agentFile, 'utf8');

  const phaseContextFn = PHASE_CONTEXTS[taskId];
  if (!phaseContextFn) {
    store.close();
    throw new Error(`No phase context defined for task ${taskId}. Is this task supported?`);
  }
  const phaseContext = phaseContextFn(task, paths);

  const providerMode = resolveProviderMode(paths);
  const model = resolveModel(paths, 'architect');

  try {
    if (providerMode === 'claude-code') {
      await runClaudeCodeMode(projectRoot, taskId, task, systemPromptContent, phaseContext, model, paths, store, bus, manager);
    } else {
      await runAnthropicApiMode(taskId, task, systemPromptContent, phaseContext, model, paths, store, bus, manager);
    }
  } finally {
    store.close();
  }
}

// ---------------------------------------------------------------------------
// Mode A: Claude Code CLI (default — uses Pro/Max plan, no API key needed)
// ---------------------------------------------------------------------------

async function runClaudeCodeMode(
  projectRoot: string,
  taskId: string,
  task: Task,
  systemPromptContent: string,
  phaseContext: string,
  model: string,
  paths: ProjectPaths,
  store: StateStore,
  bus: EventBus,
  manager: BacklogManager,
): Promise<void> {
  // Write combined system prompt to a session file for reference
  const sessionDir = join(paths.sessionsDir, taskId);
  mkdirSync(sessionDir, { recursive: true });
  const systemPromptFile = join(sessionDir, 'system-prompt.md');
  writeFileSync(
    systemPromptFile,
    `${systemPromptContent}\n\n---\n\n## Current Task: ${taskId}\n\n${phaseContext}\n`,
    'utf8',
  );

  const combinedPrompt = `${systemPromptContent}\n\n---\n\n${phaseContext}`;
  const kickoff = 'begin';

  console.log(`\n[maestro] Starting ${task.title} (${taskId}) via Claude Code`);
  console.log(`[maestro] Model: ${model}`);
  console.log(`[maestro] System prompt written to: ${systemPromptFile}\n`);

  // --append-system-prompt injects persona + task protocol on top of Claude Code's
  // built-in system prompt (so native tools still work). Positional kickoff prompt
  // forces claude to engage with the task immediately instead of waiting at empty UI.
  const launched = tryClaude([
    ['--model', model, '--append-system-prompt', combinedPrompt, kickoff],
    ['--append-system-prompt', combinedPrompt, kickoff],
    ['--model', model, kickoff],
    [kickoff],
  ], projectRoot);

  if (!launched) {
    throw new Error('Failed to launch claude CLI. Make sure Claude Code is installed and `claude` is on PATH.');
  }

  // After session ends, check if expected artifacts were created and advance task
  await postSessionCheck(taskId, task, paths, store, bus, manager);
}

/**
 * Try claude CLI with each set of args. Probes `claude --help` once to detect
 * which flags are supported, then runs the first compatible argv.
 */
function tryClaude(argSets: string[][], cwd: string): boolean {
  // Probe --help to detect installed claude + supported flags
  const probe = spawnSync('claude', ['--help'], { stdio: 'pipe' });
  if (probe.error && (probe.error as NodeJS.ErrnoException).code === 'ENOENT') {
    return false;
  }
  const help = `${probe.stdout?.toString() ?? ''}\n${probe.stderr?.toString() ?? ''}`;

  // Pick the first argv whose flags are all present in --help output
  const isFlag = (s: string) => s.startsWith('--');
  const compatible = argSets.find((args) => {
    const flags = args.filter(isFlag);
    return flags.every((f) => help.includes(f));
  }) ?? [];

  const r = spawnSync('claude', compatible, { stdio: 'inherit', cwd });
  if (r.error && (r.error as NodeJS.ErrnoException).code === 'ENOENT') return false;
  return true;
}

/**
 * After the claude session ends, check if expected artifacts were created.
 * If yes, ask the user to confirm the phase is complete and mark task done.
 */
type ArtifactCheck = { ok: boolean; missing: string[]; details?: string };

function verifyArtifacts(taskId: string, paths: ProjectPaths, manager: BacklogManager): ArtifactCheck {
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
      const tasks = manager.getTasks(paths);
      const engCount = tasks.filter((t) => t.id.startsWith('ENG-')).length;
      if (!docCheck.ok) return docCheck;
      if (engCount === 0) {
        return { ok: false, missing: ['ENG-* tasks in .maestro/backlog.json'] };
      }
      return { ok: true, missing: [], details: `${engCount} ENG-* tasks in backlog` };
    }
    case 'ARCH-005': {
      const tasks = manager.getTasks(paths);
      const engTasks = tasks.filter((t) => t.id.startsWith('ENG-'));
      const unassigned = engTasks.filter((t) => !t.assignee || t.assignee === 'architect' || t.assignee === 'unassigned');
      // count engineer agent files (any .md or .agent.md, excluding architect*)
      const entries = existsSync(paths.agents) ? readdirSync(paths.agents) : [];
      const engineerFiles = entries.filter(
        (n: string) => n.endsWith('.md') && !n.startsWith('architect'),
      );
      const missing: string[] = [];
      if (engineerFiles.length === 0) missing.push('engineer .md files in .agents/');
      if (unassigned.length > 0) missing.push(`${unassigned.length} ENG-* tasks still unassigned`);
      return { ok: missing.length === 0, missing, details: `${engineerFiles.length} engineer agent(s)` };
    }
    default:
      return { ok: false, missing: [`unknown task ${taskId}`] };
  }
}

async function postSessionCheck(
  taskId: string,
  _task: Task,
  paths: ProjectPaths,
  store: StateStore,
  bus: EventBus,
  manager: BacklogManager,
): Promise<void> {
  const check = verifyArtifacts(taskId, paths, manager);

  console.log('\n');
  if (check.ok) {
    console.log(`[maestro] ✓ All expected artifacts for ${taskId} present.${check.details ? ` (${check.details})` : ''}`);
    const answer = await makePrompt(`[maestro] Mark ${taskId} done and unlock next phase? [Y/n] `);
    if (answer.trim() === '' || answer.trim().toLowerCase().startsWith('y')) {
      manager.updateTask(paths, store, taskId, { status: 'done', completed_at: new Date().toISOString() });
      bus.publish({ type: 'phase.gate_approved', agent: 'architect', task_id: taskId, data: {} });
      bus.publish({ type: 'task.completed', agent: 'architect', task_id: taskId, data: {} });

      // Promote next task: linear ARCH chain
      const all = manager.getTasks(paths);
      const doneIds = new Set(all.filter((t) => t.status === 'done').map((t) => t.id));
      for (const t of all) {
        if (t.status === 'pending' && t.prerequisites.every((p) => doneIds.has(p))) {
          manager.updateTask(paths, store, t.id, { status: 'ready' });
          bus.publish({ type: 'task.status_changed', agent: 'architect', task_id: t.id, data: { from: 'pending', to: 'ready' } });
        }
      }

      console.log(`[maestro] Task ${taskId} marked done. Run 'maestro run' to start the next phase.\n`);
    } else {
      console.log(`[maestro] Task ${taskId} remains in_progress. Run 'maestro run ${taskId}' to continue.\n`);
    }
  } else {
    console.log(`[maestro] ✗ Missing artifacts for ${taskId}:`);
    for (const m of check.missing) console.log(`           - ${m}`);
    console.log(`[maestro] Task ${taskId} remains in_progress. Run 'maestro run ${taskId}' to continue.\n`);
  }
}

// ---------------------------------------------------------------------------
// Mode B: Anthropic SDK direct (needs ANTHROPIC_API_KEY)
// ---------------------------------------------------------------------------

async function runAnthropicApiMode(
  taskId: string,
  task: Task,
  systemPromptContent: string,
  phaseContext: string,
  model: string,
  paths: ProjectPaths,
  store: StateStore,
  bus: EventBus,
  manager: BacklogManager,
): Promise<void> {
  const provider = new AnthropicProvider();
  const ctx: ToolContext = { paths, store, bus, manager };
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: phaseContext }];

  console.log(`\n[maestro] Starting ${task.title} (${taskId}) via Anthropic API`);
  console.log(`[maestro] Model: ${model}\n`);

  while (true) {
    const currentTask = manager.getTask(paths, taskId);
    if (currentTask?.status === 'done' || currentTask?.status === 'failed') break;

    const startMs = Date.now();
    const result = await provider.streamWithTools({
      model,
      systemPrompt: systemPromptContent,
      messages,
      tools: ARCHITECT_TOOLS,
      onChunk: (text) => process.stdout.write(text),
    });
    const durationMs = Date.now() - startMs;

    recordCall(store, {
      taskId,
      agentName: 'architect',
      model,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      cachedTokens: result.cachedTokens,
      durationMs,
    });

    messages.push({ role: 'assistant', content: result.content });

    const toolUseBlocks = result.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
    );

    if (toolUseBlocks.length > 0) {
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const toolUse of toolUseBlocks) {
        process.stdout.write(`\n[tool: ${toolUse.name}]\n`);
        const toolResult = await handleArchitectTool(
          toolUse.name,
          toolUse.input as Record<string, unknown>,
          ctx,
        );
        if (isGateResult(toolResult)) {
          const approvalResult = await runApprovalLoop(toolResult.task_id, toolResult.summary, paths, store, bus, manager);
          toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: approvalResult });
        } else {
          toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: toolResult });
        }
      }
      messages.push({ role: 'user', content: toolResults });
    } else if (result.stopReason === 'end_turn') {
      const updatedTask = manager.getTask(paths, taskId);
      if (updatedTask?.status === 'done' || updatedTask?.status === 'failed') break;
      process.stdout.write('\n');
      const userInput = await makePrompt('you › ');
      if (userInput.trim() === '') continue;
      messages.push({ role: 'user', content: userInput });
    }
  }

  const finalTask = manager.getTask(paths, taskId);
  if (finalTask?.status === 'done') {
    bus.publish({ type: 'task.completed', agent: 'architect', task_id: taskId, data: {} });
    console.log(`\n[maestro] Task ${taskId} completed.\n`);
  }
}

async function runApprovalLoop(
  taskId: string,
  summary: string,
  paths: ProjectPaths,
  store: StateStore,
  bus: EventBus,
  manager: BacklogManager,
): Promise<string> {
  while (true) {
    process.stdout.write(
      `\n--- Phase Gate ---\n${summary}\n\nType 'approve' to proceed or 'revise <feedback>' to request changes:\n`,
    );
    const line = await makePrompt('> ');
    const trimmed = line.trim();
    if (trimmed.toLowerCase() === 'approve') {
      manager.updateTask(paths, store, taskId, { status: 'done', completed_at: new Date().toISOString() });
      bus.publish({ type: 'phase.gate_approved', agent: 'architect', task_id: taskId, data: {} });
      return 'The user approved. Proceed to next step.';
    } else if (trimmed.toLowerCase().startsWith('revise')) {
      const feedback = trimmed.slice('revise'.length).trim();
      bus.publish({ type: 'phase.gate_revised', agent: 'architect', task_id: taskId, data: { feedback } });
      return `The user requested revisions: ${feedback}. Please revise accordingly.`;
    } else {
      process.stdout.write("Please type 'approve' or 'revise <feedback>'.\n");
    }
  }
}
