import { Command } from 'commander';
import { MAESTRO_VERSION } from '../types.js';
import { runInit } from './commands/init.js';
import { type Provider } from '../utils/paths.js';
import { runStatus } from './commands/status.js';
import { runBacklog } from './commands/backlog.js';
import { runRun } from './commands/run.js';
import { runChat } from './commands/chat.js';
import { runStop } from './commands/stop.js';
import { runAgents } from './commands/agents.js';
import { runAgent } from './commands/agent.js';
import { runDocs } from './commands/docs.js';
import { runCost } from './commands/cost.js';
import { runLogs } from './commands/logs.js';
import { runReset } from './commands/reset.js';
import { runStart } from './commands/start.js';
import { runNextTask } from './commands/next-task.js';
import { runMarkDone } from './commands/mark-done.js';
import { runTaskContext } from './commands/task-context.js';

const program = new Command();

program
  .name('maestro')
  .description('Local CLI orchestrator for AI agents that build software collaboratively')
  .version(MAESTRO_VERSION, '-v, --version', 'output the current version');

program
  .command('init')
  .description('bootstrap a Maestro project in the current directory')
  .option('--force', 'overwrite existing .maestro directory if present', false)
  .option('--provider <name>', 'AI provider to use: claude (default), copilot, codex', 'claude')
  .option('--claude', 'shorthand for --provider claude')
  .option('--copilot', 'shorthand for --provider copilot')
  .option('--codex', 'shorthand for --provider codex')
  .action(async (opts) => {
    let provider: Provider = (opts.provider as Provider) ?? 'claude';
    if (opts.claude) provider = 'claude';
    if (opts.copilot) provider = 'copilot';
    if (opts.codex) provider = 'codex';
    await runInit({ cwd: process.cwd(), force: !!opts.force, provider });
  });

program
  .command('status')
  .description('global status: agents, backlog summary, costs')
  .action(async () => {
    await runStatus();
  });

program
  .command('backlog [taskId]')
  .description('full backlog list, or task detail when taskId is provided')
  .action(async (taskId?: string) => {
    await runBacklog(taskId);
  });

program
  .command('start')
  .description('start the autonomous loop: launches claude CLI with persona + loop protocol')
  .action(async () => {
    await runStart();
  });

program
  .command('next-task')
  .description('print the id and execution context of the next ready task (used by claude)')
  .action(async () => {
    await runNextTask();
  });

program
  .command('task-context <taskId>')
  .description('print full execution context for a task (used by claude via /run)')
  .action(async (taskId: string) => {
    await runTaskContext(taskId);
  });

program
  .command('mark-done <taskId>')
  .description('verify artifacts, mark a task done, promote successors, print next task context')
  .action(async (taskId: string) => {
    await runMarkDone(taskId);
  });

program
  .command('run [taskId]', { hidden: true })
  .description('legacy: spawn one-shot agent session (use `maestro start` instead)')
  .action(async (taskId?: string) => {
    await runRun(taskId);
  });

program
  .command('chat <agent>')
  .description("attach to a live agent's tmux session")
  .action(async (agent: string) => {
    await runChat(agent);
  });

program
  .command('stop <agent>')
  .description('stop an agent (in-flight task → failed or paused)')
  .action(async (agent: string) => {
    await runStop(agent);
  });

program
  .command('agents')
  .description('list defined agents')
  .action(async () => {
    await runAgents();
  });

program
  .command('agent <name>')
  .description("print the agent's .md file")
  .action(async (name: string) => {
    await runAgent(name);
  });

program
  .command('docs')
  .description('list docs files')
  .action(async () => {
    await runDocs();
  });

program
  .command('cost')
  .description('detailed cost breakdown')
  .option('--since <date>', 'filter from ISO date')
  .action(async (opts) => {
    await runCost({ since: opts.since });
  });

program
  .command('logs <taskId>')
  .description('show session logs for a task')
  .action(async (taskId: string) => {
    await runLogs(taskId);
  });

program
  .command('reset')
  .description('delete .maestro/, keep docs/ and .agents/')
  .option('--hard', 'also delete docs/ and .agents/ (destructive)', false)
  .action(async (opts) => {
    await runReset({ hard: !!opts.hard });
  });

program
  .command('_run-agent <projectRoot> <taskId>', { hidden: true })
  .description('internal: run agent task in current process (called from tmux session)')
  .action(async (projectRoot: string, taskId: string) => {
    const { runAgentTask } = await import('./commands/_run-agent.js');
    await runAgentTask(projectRoot, taskId);
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error('[maestro] error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
