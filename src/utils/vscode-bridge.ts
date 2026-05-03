import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export function runtimeFilePath(maestroDir: string): string {
  return join(maestroDir, '.runtime.json');
}

function commandsDir(maestroDir: string): string {
  return join(maestroDir, '.commands');
}

/** True if a VSCode extension session has ever activated on this project. */
export function isExtensionRegistered(maestroDir: string): boolean {
  return existsSync(runtimeFilePath(maestroDir));
}

/**
 * Drop a command file and wait up to `timeoutMs` for the extension to consume
 * it (extension deletes the file after handling). Returns true if consumed.
 */
export async function dispatchToExtension(
  maestroDir: string,
  payload: Record<string, unknown>,
  timeoutMs = 8000,
): Promise<boolean> {
  const dir = commandsDir(maestroDir);
  const file = join(dir, `${Date.now()}-${randomUUID()}.json`);
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, JSON.stringify(payload), 'utf8');
  } catch {
    return false;
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(200);
    if (!existsSync(file)) return true;
  }
  try { unlinkSync(file); } catch {}
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
