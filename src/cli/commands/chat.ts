import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { findProjectRoot, resolveProjectPaths, agentFilePath } from '../../utils/paths.js';
import { log } from '../../utils/logger.js';

const PROBE_ENV = {
  ...process.env,
  PATH: `/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/bin:/bin:${process.env.PATH ?? ''}`,
};

export async function runChat(agent: string): Promise<void> {
  const root = findProjectRoot();
  if (!root) {
    log.error('not in a maestro project — run `maestro init` first');
    process.exit(1);
  }
  const paths = resolveProjectPaths(root);

  const personaFile = agentFilePath(paths, agent);
  if (!existsSync(personaFile)) {
    log.error(`agent '${agent}' not found at ${personaFile}`);
    log.step(`available agents are stored in ${paths.agents}`);
    process.exit(1);
  }

  const probe = spawnSync('claude', ['--help'], { stdio: 'pipe', env: PROBE_ENV });
  if (probe.error && (probe.error as NodeJS.ErrnoException).code === 'ENOENT') {
    log.error('claude CLI not found on PATH — install Claude Code first');
    process.exit(1);
  }

  const r = spawnSync('claude', ['--agent', agent], { stdio: 'inherit', cwd: root, env: PROBE_ENV });
  if (r.error) {
    log.error('failed to launch claude:', r.error.message);
    process.exit(1);
  }
}
