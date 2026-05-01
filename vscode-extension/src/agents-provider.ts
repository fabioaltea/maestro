import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

type AgentInfo = {
  name: string;
  filePath: string;
  model?: string;
  skills?: string[];
  seniority?: string;
  isArchitect: boolean;
};

export class AgentsProvider implements vscode.TreeDataProvider<AgentNode> {
  private _onDidChange = new vscode.EventEmitter<AgentNode | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  constructor(private readonly root: string) {}

  refresh(): void {
    this._onDidChange.fire();
  }

  getTreeItem(node: AgentNode): vscode.TreeItem {
    return node;
  }

  async getChildren(node?: AgentNode): Promise<AgentNode[]> {
    if (node) return node.children ?? [];

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

function parseAgent(filePath: string): AgentInfo {
  const name = path.basename(filePath, '.md');
  const isArchitect = name === 'architect';
  let model: string | undefined;
  let skills: string[] | undefined;
  let seniority: string | undefined;

  try {
    const text = fs.readFileSync(filePath, 'utf8');
    const fm = extractFrontmatter(text);
    if (fm) {
      model = matchScalar(fm, 'model');
      seniority = matchScalar(fm, 'seniority');
      skills = matchList(fm, 'skills');
    }
  } catch {}

  return { name, filePath, model, skills, seniority, isArchitect };
}

function extractFrontmatter(text: string): string | null {
  if (!text.startsWith('---')) return null;
  const end = text.indexOf('\n---', 3);
  if (end === -1) return null;
  return text.slice(3, end);
}

function matchScalar(fm: string, key: string): string | undefined {
  const re = new RegExp(`^${key}\\s*:\\s*(.+)$`, 'm');
  const m = fm.match(re);
  return m ? m[1].trim() : undefined;
}

function matchList(fm: string, key: string): string[] | undefined {
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
  children?: vscode.TreeItem[];

  constructor(info: AgentInfo) {
    super(info.name, vscode.TreeItemCollapsibleState.None);
    const parts: string[] = [];
    if (info.isArchitect) parts.push('architect');
    if (info.seniority) parts.push(info.seniority);
    if (info.model) parts.push(info.model);
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
    (this as any).agentName = info.name;
    (this as any).agentFilePath = info.filePath;
  }
}

class InfoNode extends vscode.TreeItem {
  constructor(message: string) {
    super(message, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('info');
  }
}
