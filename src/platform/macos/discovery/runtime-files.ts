import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { requireUuid } from '../../../domain/identifiers.js';
import type { DiscoveryRunFilesPort } from '../../../ports/provider.js';
import type { ArchivePaths } from '../../../ports/platform.js';
import { CODEX_DISCOVERY_QUALIFICATION } from '../../../providers/codex/capabilities.js';
import { createPlatformPaths } from '../paths.js';
import { privateDirectory } from './provider-launcher.js';

/** Dedicated OS/filesystem boundary. Called only after durable run admission. */
export function createDiscoveryRunFiles(paths: ArchivePaths): DiscoveryRunFilesPort {
  return { async prepare(runId) {
    try {
      requireUuid(runId);
      const current = await createPlatformPaths().resolveArchive(paths.directory, 'read');
      if (!current || current.runtimeDirectory !== paths.runtimeDirectory || current.credentialsDirectory !== paths.credentialsDirectory) throw new Error('PROVIDER_UNSAFE');
      await privateDirectory(paths.runtimeDirectory);
      const bytes = await readFile(new URL('../../../providers/codex/discovery-result.schema.json', import.meta.url));
      if (bytes.byteLength > 64 * 1024 || createHash('sha256').update(bytes).digest('hex') !== CODEX_DISCOVERY_QUALIFICATION.schemaSha256) throw new Error('PROVIDER_UNSAFE');
      const runtime = join(paths.runtimeDirectory, `p-${runId}`), schema = join(runtime, 'result.schema.json');
      // A retry never overwrites an unknown or partially prepared runtime.
      await mkdir(runtime, { mode: 0o700 }); await privateDirectory(runtime);
      const file = await open(schema, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
      for (const path of [runtime, paths.runtimeDirectory]) {
        const directory = await open(path, constants.O_RDONLY); try { await directory.sync(); } finally { await directory.close(); }
      }
      return { ok: true, value: { runtime, schema } };
    } catch { return { ok: false, code: 'PROVIDER_UNSAFE' }; }
  } };
}
