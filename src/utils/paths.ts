import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The AI provider used to run agents. */
export type Provider = 'claude' | 'copilot' | 'codex';

export type ProjectPaths = {
  root: string;
  provider: Provider;
  docs: string;
  /** Provider-native agent definitions directory. Varies per provider:
   *  - claude  → .claude/agents/
   *  - copilot → .github/copilot/agents/
   *  - codex   → .codex/agents/
   */
  agents: string;
  agentsBase: string;         // .agents/_base    (maestro-side templates for staffing)
  agentsArchive: string;      // .agents/_archive (compacted learnings)
  claudeDir: string;          // .claude/
  /** Slash-command directory (only populated for the claude provider). */
  claudeCommands: string;     // .claude/commands/
  maestroDir: string;
  configFile: string;
  backlogJson: string;
  eventsLog: string;
  sessionsDir: string;
  versionFile: string;
};

const PROVIDER_AGENTS_DIR: Record<Provider, (root: string) => string> = {
  claude:  (root) => join(root, '.claude', 'agents'),
  copilot: (root) => join(root, '.github', 'agents'),
  codex:   (root) => join(root, '.codex', 'agents'),
};

export function projectPathsFor(root: string, provider: Provider = 'claude'): ProjectPaths {
  const maestroDir = join(root, '.maestro');
  const agentsBaseRoot = join(root, '.agents');
  const claudeDir = join(root, '.claude');
  return {
    root,
    provider,
    docs: join(root, 'docs'),
    agents: PROVIDER_AGENTS_DIR[provider](root),
    agentsBase: join(agentsBaseRoot, '_base'),
    agentsArchive: join(agentsBaseRoot, '_archive'),
    claudeDir,
    claudeCommands: join(claudeDir, 'commands'),
    maestroDir,
    configFile: join(maestroDir, 'config.yaml'),
    backlogJson: join(maestroDir, 'backlog.json'),
    eventsLog: join(maestroDir, 'events.log'),
    sessionsDir: join(maestroDir, 'sessions'),
    versionFile: join(maestroDir, 'version'),
  };
}

export function findProjectRoot(start: string = process.cwd()): string | null {
  let dir = resolve(start);
  while (true) {
    if (existsSync(join(dir, '.maestro'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Returns the filename suffix for agent definition files for the given provider.
 *  - claude / codex → `<name>.md`
 *  - copilot        → `<name>.agent.md`
 */
export function agentFileName(provider: Provider, agentName: string): string {
  return provider === 'copilot' ? `${agentName}.agent.md` : `${agentName}.md`;
}

/**
 * Returns the full path to an agent definition file for the given provider.
 */
export function agentFilePath(paths: ProjectPaths, agentName: string): string {
  return join(paths.agents, agentFileName(paths.provider, agentName));
}

export function userGlobalConfigDir(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
  return join(home, '.maestro');
}

export function userGlobalConfigFile(): string {
  return join(userGlobalConfigDir(), 'config.yaml');
}

export function packageRoot(): string {
  // src/utils/paths.ts -> ../../  (when compiled: dist/utils/paths.js -> ../../)
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..', '..');
}

export function templatesDir(): string {
  const root = packageRoot();
  const candidate = join(root, 'templates');
  if (existsSync(candidate) && statSync(candidate).isDirectory()) return candidate;
  // dist build sits at <pkg>/dist; templates live at <pkg>/templates
  const fallback = join(root, '..', 'templates');
  return fallback;
}

/**
 * Read the provider_mode from .maestro/config.yaml and return the matching Provider.
 * Falls back to 'claude' if the file is missing or unreadable.
 */
export function providerFromConfig(root: string): Provider {
  const cfgFile = join(root, '.maestro', 'config.yaml');
  if (!existsSync(cfgFile)) return 'claude';
  try {
    const content = readFileSync(cfgFile, 'utf8');
    const match = content.match(/^provider_mode:\s*['"]?([\w-]+)['"]?\s*$/m);
    if (match?.[1] === 'copilot') return 'copilot';
    if (match?.[1] === 'codex') return 'codex';
  } catch {}
  return 'claude';
}

/**
 * Resolve ProjectPaths for a root directory, automatically reading the provider
 * from .maestro/config.yaml so callers don't have to pass it manually.
 */
export function resolveProjectPaths(root: string): ProjectPaths {
  return projectPathsFor(root, providerFromConfig(root));
}
