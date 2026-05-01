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
exports.AgentsProvider = void 0;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
class AgentsProvider {
    root;
    _onDidChange = new vscode.EventEmitter();
    onDidChangeTreeData = this._onDidChange.event;
    constructor(root) {
        this.root = root;
    }
    refresh() {
        this._onDidChange.fire();
    }
    getTreeItem(node) {
        return node;
    }
    async getChildren(node) {
        if (node)
            return node.children ?? [];
        const agentsDir = path.join(this.root, '.claude', 'agents');
        if (!fs.existsSync(agentsDir)) {
            return [new InfoNode('No .claude/agents directory — run `maestro init` first.')];
        }
        const entries = fs
            .readdirSync(agentsDir)
            .filter((n) => n.endsWith('.md'))
            .sort((a, b) => (a === 'architect.md' ? -1 : b === 'architect.md' ? 1 : a.localeCompare(b)));
        if (entries.length === 0) {
            return [new InfoNode('No agent files in .claude/agents/.')];
        }
        return entries.map((file) => {
            const full = path.join(agentsDir, file);
            const info = parseAgent(full);
            return new AgentNode(info);
        });
    }
}
exports.AgentsProvider = AgentsProvider;
function parseAgent(filePath) {
    const name = path.basename(filePath, '.md');
    const isArchitect = name === 'architect';
    let model;
    let skills;
    let seniority;
    try {
        const text = fs.readFileSync(filePath, 'utf8');
        const fm = extractFrontmatter(text);
        if (fm) {
            model = matchScalar(fm, 'model');
            seniority = matchScalar(fm, 'seniority');
            skills = matchList(fm, 'skills');
        }
    }
    catch { }
    return { name, filePath, model, skills, seniority, isArchitect };
}
function extractFrontmatter(text) {
    if (!text.startsWith('---'))
        return null;
    const end = text.indexOf('\n---', 3);
    if (end === -1)
        return null;
    return text.slice(3, end);
}
function matchScalar(fm, key) {
    const re = new RegExp(`^${key}\\s*:\\s*(.+)$`, 'm');
    const m = fm.match(re);
    return m ? m[1].trim() : undefined;
}
function matchList(fm, key) {
    // inline form: skills: [a, b, c]
    const inline = new RegExp(`^${key}\\s*:\\s*\\[([^\\]]*)\\]`, 'm');
    const im = fm.match(inline);
    if (im) {
        return im[1]
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
    }
    return undefined;
}
class AgentNode extends vscode.TreeItem {
    children;
    constructor(info) {
        super(info.name, vscode.TreeItemCollapsibleState.None);
        const parts = [];
        if (info.isArchitect)
            parts.push('architect');
        if (info.seniority)
            parts.push(info.seniority);
        if (info.model)
            parts.push(info.model);
        this.description = parts.join(' · ');
        const tipLines = [
            `**${info.name}**`,
            info.model ? `Model: ${info.model}` : '',
            info.seniority ? `Seniority: ${info.seniority}` : '',
            info.skills && info.skills.length > 0 ? `Skills: ${info.skills.join(', ')}` : '',
            `File: ${vscode.workspace.asRelativePath(info.filePath)}`,
        ].filter(Boolean);
        this.tooltip = new vscode.MarkdownString(tipLines.join('\n\n'));
        this.iconPath = new vscode.ThemeIcon(info.isArchitect ? 'organization' : 'person');
        this.contextValue = info.isArchitect ? 'agent.architect' : 'agent.engineer';
        this.command = {
            command: 'maestro.chatAgent',
            title: 'Chat with agent',
            arguments: [info.name, info.filePath],
        };
        this.agentName = info.name;
        this.agentFilePath = info.filePath;
    }
}
class InfoNode extends vscode.TreeItem {
    constructor(message) {
        super(message, vscode.TreeItemCollapsibleState.None);
        this.iconPath = new vscode.ThemeIcon('info');
    }
}
//# sourceMappingURL=agents-provider.js.map