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
exports.BacklogProvider = void 0;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const STATUS_ORDER = [
    'in_progress',
    'awaiting_approval',
    'blocked_needs_user',
    'blocked',
    'ready',
    'pending',
    'failed',
    'done',
];
const STATUS_VISUAL = {
    ready: { icon: 'circle-filled', color: 'charts.green' },
    in_progress: { icon: 'sync~spin', color: 'charts.blue' },
    awaiting_approval: { icon: 'circle-filled', color: 'charts.yellow' },
    blocked: { icon: 'circle-filled', color: 'charts.orange' },
    blocked_needs_user: { icon: 'circle-filled', color: 'charts.orange' },
    pending: { icon: 'circle-outline', color: 'disabledForeground' },
    failed: { icon: 'circle-filled', color: 'charts.red' },
    done: { icon: 'pass-filled', color: 'charts.green' },
};
function statusIcon(status) {
    const v = STATUS_VISUAL[status] ?? { icon: 'circle' };
    return v.color ? new vscode.ThemeIcon(v.icon, new vscode.ThemeColor(v.color)) : new vscode.ThemeIcon(v.icon);
}
class BacklogProvider {
    root;
    _onDidChange = new vscode.EventEmitter();
    onDidChangeTreeData = this._onDidChange.event;
    grouping = 'status';
    constructor(root) {
        this.root = root;
    }
    refresh() {
        this._onDidChange.fire();
    }
    toggleGrouping() {
        this.grouping = this.grouping === 'status' ? 'assignee' : 'status';
        vscode.window.setStatusBarMessage(`Maestro: backlog grouped by ${this.grouping}`, 2000);
        this.refresh();
    }
    getTreeItem(item) {
        return item;
    }
    async getChildren(node) {
        if (node instanceof GroupNode) {
            return node.tasks.map((t) => new TaskNode(t));
        }
        if (node)
            return [];
        const backlog = this.loadBacklog();
        if (!backlog) {
            return [new InfoNode('No .maestro/backlog.json — run `maestro init`.')];
        }
        if (backlog.tasks.length === 0) {
            return [new InfoNode('Backlog is empty.')];
        }
        if (this.grouping === 'status')
            return this.groupByStatus(backlog.tasks);
        return this.groupByAssignee(backlog.tasks);
    }
    loadBacklog() {
        const file = path.join(this.root, '.maestro', 'backlog.json');
        if (!fs.existsSync(file))
            return null;
        try {
            return JSON.parse(fs.readFileSync(file, 'utf8'));
        }
        catch (err) {
            vscode.window.showErrorMessage(`Maestro: failed to parse backlog.json — ${err.message}`);
            return null;
        }
    }
    groupByStatus(tasks) {
        const buckets = new Map();
        for (const t of tasks) {
            const arr = buckets.get(t.status) ?? [];
            arr.push(t);
            buckets.set(t.status, arr);
        }
        const ordered = STATUS_ORDER.filter((s) => buckets.has(s));
        const extra = [...buckets.keys()].filter((k) => !STATUS_ORDER.includes(k));
        return [...ordered, ...extra].map((status) => {
            const list = (buckets.get(status) ?? []).sort((a, b) => a.id.localeCompare(b.id));
            return new GroupNode(`${status} (${list.length})`, list, statusIcon(status));
        });
    }
    groupByAssignee(tasks) {
        const buckets = new Map();
        for (const t of tasks) {
            const key = t.assignee || 'unassigned';
            const arr = buckets.get(key) ?? [];
            arr.push(t);
            buckets.set(key, arr);
        }
        const keys = [...buckets.keys()].sort((a, b) => {
            if (a === 'architect')
                return -1;
            if (b === 'architect')
                return 1;
            return a.localeCompare(b);
        });
        return keys.map((assignee) => {
            const list = (buckets.get(assignee) ?? []).sort((a, b) => a.id.localeCompare(b.id));
            const iconId = assignee === 'architect' ? 'organization' : assignee === 'unassigned' ? 'question' : 'person';
            return new GroupNode(`${assignee} (${list.length})`, list, new vscode.ThemeIcon(iconId));
        });
    }
}
exports.BacklogProvider = BacklogProvider;
class GroupNode extends vscode.TreeItem {
    tasks;
    constructor(label, tasks, icon) {
        super(label, vscode.TreeItemCollapsibleState.Expanded);
        this.tasks = tasks;
        this.iconPath = icon;
        this.contextValue = 'backlog.group';
    }
}
class TaskNode extends vscode.TreeItem {
    constructor(task) {
        super(`${task.id}  ${task.title}`, vscode.TreeItemCollapsibleState.None);
        const parts = [];
        if (task.assignee)
            parts.push(task.assignee);
        if (task.area)
            parts.push(task.area);
        if (task.complexity)
            parts.push(task.complexity);
        this.description = parts.join(' · ');
        const lines = [
            `**${task.id} — ${task.title}**`,
            `Status: \`${task.status}\``,
            `Assignee: ${task.assignee}`,
            `Area: ${task.area} · Complexity: ${task.complexity}`,
            task.prerequisites.length > 0 ? `Prereqs: ${task.prerequisites.join(', ')}` : '',
            task.required_skills.length > 0 ? `Skills: ${task.required_skills.join(', ')}` : '',
            '',
            task.description,
            '',
            task.acceptance_criteria.length > 0
                ? `**Acceptance:**\n${task.acceptance_criteria.map((c) => `- ${c}`).join('\n')}`
                : '',
        ].filter(Boolean);
        this.tooltip = new vscode.MarkdownString(lines.join('\n\n'));
        this.iconPath = statusIcon(task.status);
        this.contextValue = `backlog.task.${task.status}`;
        this.command = { command: 'maestro.openBacklog', title: 'Open backlog.json' };
        this.taskId = task.id;
        this.taskStatus = task.status;
        this.taskAssignee = task.assignee;
    }
}
class InfoNode extends vscode.TreeItem {
    constructor(message) {
        super(message, vscode.TreeItemCollapsibleState.None);
        this.iconPath = new vscode.ThemeIcon('info');
    }
}
//# sourceMappingURL=backlog-provider.js.map