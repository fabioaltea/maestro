import { existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type ProjectPaths = {
  root: string;
  docs: string;
  agents: string;
  agentsBase: string;
  agentsArchive: string;
  maestroDir: string;
  configFile: string;
  stateDb: string;
  backlogJson: string;
  eventsLog: string;
  sessionsDir: string;
  versionFile: string;
};

export function projectPathsFor(root: string): ProjectPaths {
  const maestroDir = join(root, '.maestro');
  const agents = join(root, '.agents');
  return {
    root,
    docs: join(root, 'docs'),
    agents,
    agentsBase: join(agents, '_base'),
    agentsArchive: join(agents, '_archive'),
    maestroDir,
    configFile: join(maestroDir, 'config.yaml'),
    stateDb: join(maestroDir, 'state.db'),
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
