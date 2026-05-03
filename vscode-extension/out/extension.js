"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const agents_provider_1 = require("./agents-provider");
const backlog_provider_1 = require("./backlog-provider");
function activate(context) {
    const workspace = vscode.workspace.workspaceFolders?.[0];
    if (!workspace)
        return;
    const root = workspace.uri.fsPath;
    const maestroDir = path.join(root, '.maestro');
    const commandsDir = path.join(maestroDir, '.commands');
    try {
        fs.mkdirSync(commandsDir, { recursive: true });
    }
    catch { }
    const agents = new agents_provider_1.AgentsProvider(root);
    const backlog = new backlog_provider_1.BacklogProvider(root);
    context.subscriptions.push(vscode.window.registerTreeDataProvider('maestro.agents', agents), vscode.window.registerTreeDataProvider('maestro.backlog', backlog));
    // File watchers — refresh on underlying changes
    const agentsWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(workspace, '.claude/agents/**/*.md'));
    agentsWatcher.onDidChange(() => agents.refresh());
    agentsWatcher.onDidCreate(() => agents.refresh());
    agentsWatcher.onDidDelete(() => agents.refresh());
    const backlogWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(workspace, '.maestro/backlog.json'));
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
    const agentTerms = new Map();
    // Track tasks already auto-fired this session so we never re-trigger the same id.
    const autoFired = new Set();
    let prevInProgressCount;
    const readBacklog = () => {
        const file = path.join(root, '.maestro', 'backlog.json');
        if (!fs.existsSync(file))
            return null;
        try {
            const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
            return Array.isArray(parsed?.tasks) ? parsed.tasks : null;
        }
        catch {
            return null;
        }
    };
    const maybeAutoRunNext = () => {
        const tasks = readBacklog();
        if (!tasks)
            return;
        const inProgress = tasks.filter((t) => t.status === 'in_progress').length;
        const ready = tasks
            .filter((t) => t.status === 'ready' && !autoFired.has(t.id))
            .sort((a, b) => a.id.localeCompare(b.id));
        // Auto-fire when:
        //  - we previously had at least one in_progress (i.e. a task just completed), and
        //  - there are now zero in_progress, and
        //  - there is at least one ready task we haven't already triggered.
        const shouldFire = prevInProgressCount !== undefined &&
            prevInProgressCount > 0 &&
            inProgress === 0 &&
            ready.length > 0;
        prevInProgressCount = inProgress;
        if (!shouldFire)
            return;
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
    if (bootTasks)
        prevInProgressCount = bootTasks.filter((t) => t.status === 'in_progress').length;
    const getOrCreateAgentTerminal = (agentName) => {
        const existing = agentTerms.get(agentName);
        if (existing && existing.terminal.exitStatus === undefined)
            return existing;
        const terminal = vscode.window.createTerminal({ name: `agent: ${agentName}`, cwd: root });
        const rec = { terminal, claudeStarted: false };
        agentTerms.set(agentName, rec);
        return rec;
    };
    const startClaudeForAgent = (rec, agentName, initialPrompt) => {
        const promptArg = initialPrompt ? ` ${shellQuote(initialPrompt)}` : '';
        rec.terminal.sendText(`claude --agent ${shellQuote(agentName)}${promptArg}`, true);
        rec.claudeStarted = true;
    };
    context.subscriptions.push(vscode.window.onDidCloseTerminal((closed) => {
        for (const [k, v] of agentTerms)
            if (v.terminal === closed)
                agentTerms.delete(k);
    }), vscode.commands.registerCommand('maestro.refresh', () => {
        agents.refresh();
        backlog.refresh();
    }), vscode.commands.registerCommand('maestro.openAgent', async (arg) => {
        const filePath = typeof arg === 'string' ? arg : arg?.agentFilePath;
        if (!filePath)
            return;
        const doc = await vscode.workspace.openTextDocument(filePath);
        await vscode.window.showTextDocument(doc);
    }), vscode.commands.registerCommand('maestro.openBacklog', async () => {
        const file = path.join(root, '.maestro', 'backlog.json');
        const doc = await vscode.workspace.openTextDocument(file);
        await vscode.window.showTextDocument(doc);
    }), vscode.commands.registerCommand('maestro.toggleBacklogGrouping', () => {
        backlog.toggleGrouping();
    }), 
    // Chat with an agent: open/focus that agent's terminal. Spawn `claude --agent <name>`
    // on first activation; on subsequent calls just focus the existing session.
    vscode.commands.registerCommand('maestro.chatAgent', (nameArg) => {
        const name = typeof nameArg === 'string' ? nameArg : nameArg?.agentName;
        if (!name)
            return;
        const rec = getOrCreateAgentTerminal(name);
        rec.terminal.show(false);
        if (!rec.claudeStarted)
            startClaudeForAgent(rec, name);
    }), 
    // Run a task: route to the assignee's terminal. If claude isn't running yet there,
    // spawn it with `/run <id>` as the initial prompt. If it is, send `/run <id>` as a
    // chat message into the live TUI.
    vscode.commands.registerCommand('maestro.runTask', (arg) => {
        const id = typeof arg === 'string' ? arg : arg?.taskId;
        const status = typeof arg === 'string' ? undefined : arg?.taskStatus;
        const assignee = typeof arg === 'string' ? undefined : arg?.taskAssignee;
        if (!id)
            return;
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
        }
        else {
            rec.terminal.sendText(`/run ${id}`, true);
        }
    }));
    // CLI ↔ extension bridge: CLI drops JSON files in .maestro/.commands/,
    // extension picks them up, dispatches the action, deletes the file.
    const cmdWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(workspace, '.maestro/.commands/*.json'));
    const handleCommandFile = async (uri) => {
        const file = uri.fsPath;
        let payload;
        try {
            payload = JSON.parse(fs.readFileSync(file, 'utf8'));
        }
        catch {
            try {
                fs.unlinkSync(file);
            }
            catch { }
            return;
        }
        try {
            fs.unlinkSync(file);
        }
        catch { }
        if (!payload || typeof payload.action !== 'string')
            return;
        switch (payload.action) {
            case 'runTask':
                await vscode.commands.executeCommand('maestro.runTask', {
                    taskId: payload.taskId,
                    taskStatus: payload.taskStatus,
                    taskAssignee: payload.taskAssignee,
                });
                break;
            case 'chatAgent':
                await vscode.commands.executeCommand('maestro.chatAgent', payload.agentName);
                break;
        }
    };
    cmdWatcher.onDidCreate(handleCommandFile);
    cmdWatcher.onDidChange(handleCommandFile);
    context.subscriptions.push(cmdWatcher);
    // Drain files that arrived before the watcher armed.
    try {
        for (const entry of fs.readdirSync(commandsDir)) {
            if (entry.endsWith('.json')) {
                void handleCommandFile(vscode.Uri.file(path.join(commandsDir, entry)));
            }
        }
    }
    catch { }
}
function deactivate() { }
function shellQuote(s) {
    if (/^[A-Za-z0-9_./:@%+-]+$/.test(s))
        return s;
    return `'${s.replace(/'/g, "'\\''")}'`;
}
//# sourceMappingURL=extension.js.map