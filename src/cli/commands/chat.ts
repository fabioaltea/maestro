import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { findProjectRoot, resolveProjectPaths, agentFilePath } from '../../utils/paths.js';

export async function runChat(agent: string): Promise<void> {
  const root = findProjectRoot();
  if (!root) {
    console.error('[maestro] Not in a maestro project. Run `maestro init` first.');
    process.exit(1);
  }
  const paths = resolveProjectPaths(root);

  const personaFile = agentFilePath(paths, agent);
  if (!existsSync(personaFile)) {
    console.error(`[maestro] Agent '${agent}' not found at ${personaFile}.`);
    console.error(`           Available agents are stored in ${paths.agents}.`);
    process.exit(1);
  }

  const probe = spawnSync('claude', ['--help'], { stdio: 'pipe', shell: true });
  if (probe.error && (probe.error as NodeJS.ErrnoException).code === 'ENOENT') {
    console.error('[maestro] claude CLI not found on PATH. Install Claude Code first.');
    process.exit(1);
  }

  const r = spawnSync('claude', ['--agent', agent], { stdio: 'inherit', cwd: root });
  if (r.error) {
    console.error('[maestro] failed to launch claude:', r.error.message);
    process.exit(1);
  }
}
