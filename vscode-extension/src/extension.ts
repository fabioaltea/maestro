import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { AgentsProvider } from './agents-provider';
import { BacklogProvider } from './backlog-provider';

type AgentTerm = { terminal: vscode.Terminal; claudeStarted: boolean };

type Task = {
  id: string;
  title: string;
  status: string;
  assignee: string;
  prerequisites: string[];
};

export function activate(context: vscode.ExtensionContext): void {
  const workspace = vscode.workspace.workspaceFolders?.[0];
  if (!workspace) return;
  const root = workspace.uri.fsPath;

  const agents = new AgentsProvider(root);
  const backlog = new BacklogProvider(root);

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('maestro.agents', agents),
    vscode.window.registerTreeDataProvider('maestro.backlog', backlog),
  );

  // File watchers — refresh on underlying changes
  const agentsWatcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(workspace, '.claude/agents/**/*.md'),
  );
  agentsWatcher.onDidChange(() => agents.refresh());
  agentsWatcher.onDidCreate(() => agents.refresh());
  agentsWatcher.onDidDelete(() => agents.refresh());

  const backlogWatcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(workspace, '.maestro/backlog.json'),
  );
  backlogWatcher.onDidChange(() => {
    backlog.refresh();
    maybeAutoRunNext();
  });
  backlogWatcher.onDidCreate(() => {
    backlog.refresh();
    maybeAutoRunNext();
  });

  context.subscriptions.push(agentsWatcher, backlogWatcher);

  // One terminal per agent. Reused across chat + run-task clicks for the same agent.
  const agentTerms = new Map<string, AgentTerm>();

  // Track tasks already auto-fired this session so we never re-trigger the same id.
  const autoFired = new Set<string>();
  let prevInProgressCount: number | undefined;

  const readBacklog = (): Task[] | null => {
    const file = path.join(root, '.maestro', 'backlog.json');
    if (!fs.existsSync(file)) return null;
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      return Array.isArray(parsed?.tasks) ? (parsed.tasks as Task[]) : null;
    } catch {
      return null;
    }
  };

  const maybeAutoRunNext = (): void => {
    const tasks = readBacklog();
    if (!tasks) return;
    const inProgress = tasks.filter((t) => t.status === 'in_progress').length;
    const ready = tasks
      .filter((t) => t.status === 'ready' && !autoFired.has(t.id))
      .sort((a, b) => a.id.localeCompare(b.id));

    // Auto-fire when:
    //  - we previously had at least one in_progress (i.e. a task just completed), and
    //  - there are now zero in_progress, and
    //  - there is at least one ready task we haven't already triggered.
    const shouldFire =
      prevInProgressCount !== undefined &&
      prevInProgressCount > 0 &&
      inProgress === 0 &&
      ready.length > 0;

    prevInProgressCount = inProgress;

    if (!shouldFire) return;
    const next = ready[0];
    autoFired.add(next.id);
    vscode.window.setStatusBarMessage(`Maestro: auto-running ${next.id} on ${next.assignee}`, 4000);
    vscode.commands.executeCommand('maestro.runTask', {
      taskId: next.id,
      taskStatus: next.status,
      taskAssignee: next.assignee,
    });
  };

  // Seed prevInProgressCount on activation so we don't auto-fire the first time.
  const bootTasks = readBacklog();
  if (bootTasks) prevInProgressCount = bootTasks.filter((t) => t.status === 'in_progress').length;

  const getOrCreateAgentTerminal = (agentName: string): AgentTerm => {
    const existing = agentTerms.get(agentName);
    if (existing && existing.terminal.exitStatus === undefined) return existing;
    const terminal = vscode.window.createTerminal({ name: `agent: ${agentName}`, cwd: root });
    const rec: AgentTerm = { terminal, claudeStarted: false };
    agentTerms.set(agentName, rec);
    return rec;
  };

  const startClaudeForAgent = (rec: AgentTerm, agentName: string, initialPrompt?: string): void => {
    const promptArg = initialPrompt ? ` ${shellQuote(initialPrompt)}` : '';
    rec.terminal.sendText(`claude --agent ${shellQuote(agentName)}${promptArg}`, true);
    rec.claudeStarted = true;
  };

  context.subscriptions.push(
    vscode.window.onDidCloseTerminal((closed) => {
      for (const [k, v] of agentTerms) if (v.terminal === closed) agentTerms.delete(k);
    }),

    vscode.commands.registerCommand('maestro.refresh', () => {
      agents.refresh();
      backlog.refresh();
    }),

    vscode.commands.registerCommand('maestro.openAgent', async (arg: unknown) => {
      const filePath = typeof arg === 'string' ? arg : (arg as any)?.agentFilePath;
      if (!filePath) return;
      const doc = await vscode.workspace.openTextDocument(filePath);
      await vscode.window.showTextDocument(doc);
    }),

    vscode.commands.registerCommand('maestro.openBacklog', async () => {
      const file = path.join(root, '.maestro', 'backlog.json');
      const doc = await vscode.workspace.openTextDocument(file);
      await vscode.window.showTextDocument(doc);
    }),

    vscode.commands.registerCommand('maestro.toggleBacklogGrouping', () => {
      backlog.toggleGrouping();
    }),

    // Chat with an agent: open/focus that agent's terminal. Spawn `claude --agent <name>`
    // on first activation; on subsequent calls just focus the existing session.
    vscode.commands.registerCommand('maestro.chatAgent', (nameArg?: unknown) => {
      const name = typeof nameArg === 'string' ? nameArg : (nameArg as any)?.agentName;
      if (!name) return;
      const rec = getOrCreateAgentTerminal(name);
      rec.terminal.show(false);
      if (!rec.claudeStarted) startClaudeForAgent(rec, name);
    }),

    // Run a task: route to the assignee's terminal. If claude isn't running yet there,
    // spawn it with `/run <id>` as the initial prompt. If it is, send `/run <id>` as a
    // chat message into the live TUI.
    vscode.commands.registerCommand('maestro.runTask', (arg?: unknown) => {
      const id: string | undefined = typeof arg === 'string' ? arg : (arg as any)?.taskId;
      const status: string | undefined = typeof arg === 'string' ? undefined : (arg as any)?.taskStatus;
      const assignee: string | undefined = typeof arg === 'string' ? undefined : (arg as any)?.taskAssignee;
      if (!id) return;
      if (status && status !== 'ready' && status !== 'in_progress') {
        vscode.window.showWarningMessage(`Task ${id} is '${status}', not runnable.`);
        return;
      }
      if (!assignee) {
        vscode.window.showErrorMessage(`Task ${id} has no assignee.`);
        return;
      }
      const rec = getOrCreateAgentTerminal(assignee);
      rec.terminal.show(false);
      if (!rec.claudeStarted) {
        startClaudeForAgent(rec, assignee, `/run ${id}`);
      } else {
        rec.terminal.sendText(`/run ${id}`, true);
      }
    }),
  );
}

export function deactivate(): void {}

function shellQuote(s: string): string {
  if (/^[A-Za-z0-9_./:@%+-]+$/.test(s)) return s;
  return `'${s.replace(/'/g, "'\\''")}'`;
}
