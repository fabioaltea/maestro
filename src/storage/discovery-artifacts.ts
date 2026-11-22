import type Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import type { Stats } from 'node:fs';
import { constants, closeSync, existsSync, fstatSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readSync, opendirSync, realpathSync, statfsSync, unlinkSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import type { DiscoveryArtifact, DiscoveryArtifactBudget, DiscoveryArtifactStoragePort } from '../ports/discovery.js';
import { DISCOVERY_LIMITS as limits, type DiscoveryResult } from '../domain/discovery/model.js';
import { requireUuid, requireDecimal } from '../domain/identifiers.js';
import { DISCOVERY_TABLES, requireDiscoverySchema } from './discovery-schema.js';
import { discoveryStorageFailure } from './discovery-store.js';

type Row = Record<string, string | number | bigint | null>;
type Stat = Stats;
const caps = Object.freeze({ MANIFEST: limits.inputBytes, CORPUS: limits.corpusBytes, DOCUMENT: limits.documentBytes, OUTPUT: limits.chunkBytes, EXIT_PROOF: limits.chunkBytes });
function fail(code: string): never { throw new Error(code); }
export function isPrivateArtifact(stat: { uid: number; mode: number; nlink: number; isFile(): boolean }, ownerUid: number): boolean {
  return stat.isFile() && stat.uid === ownerUid && (stat.mode & 0o7777) === 0o600 && stat.nlink === 1;
}
function dto(row: Row): DiscoveryArtifact {
  return { artifactId: String(row.artifact_id), relativeKey: String(row.relative_key), kind: row.kind as DiscoveryArtifact['kind'], sha256: row.sha256 === null ? null : String(row.sha256), allocatedBytes: Number(row.allocated_bytes), state: row.state as DiscoveryArtifact['state'], referenceCount: Number(row.ref_count) };
}
/** Counts every occupied Discovery btree page, including its indexes and unused page space.
 * Global SQLite freelist/WAL pages are shared with Foundation, not attributed twice. */
export function discoveryBudget(database: Database.Database): DiscoveryArtifactBudget {
  const names = database.prepare(`SELECT name FROM sqlite_schema WHERE type IN ('table','index') AND tbl_name IN (${DISCOVERY_TABLES.map(() => '?').join(',')})`).all(...DISCOVERY_TABLES) as { name: string }[];
  let metadataBytes = 0;
  const pages = database.prepare('SELECT coalesce(sum(pgsize),0) AS bytes FROM dbstat WHERE name=?');
  for (const { name } of names) metadataBytes += Number((pages.get(name) as { bytes: number | bigint }).bytes);
  const b = database.prepare('SELECT * FROM discovery_budget WHERE singleton=1').get() as Row;
  return { allocatedBytes: Number(b.allocated_bytes), reservedBytes: Number(b.reserved_bytes), metadataBytes, allocatedFiles: Number(b.allocated_files), reservedFiles: Number(b.reserved_files) };
}
/** Call inside the existing writer transaction, after metadata/index growth is known. */
export function enforceDiscoveryBudget(database: Database.Database, terminal: boolean): void {
  const b = discoveryBudget(database), total = b.allocatedBytes + b.reservedBytes + b.metadataBytes;
  if (total > limits.artifactBytes - (terminal ? 0 : limits.terminalReserveBytes) || b.allocatedFiles + b.reservedFiles > limits.artifactFiles - (terminal ? 0 : 2)) fail('DISCOVERY_LIMIT');
  database.prepare('UPDATE discovery_budget SET metadata_bytes=? WHERE singleton=1 AND metadata_bytes<>?').run(b.metadataBytes, b.metadataBytes);
}
type SyncArtifactPort = { [K in keyof Required<DiscoveryArtifactStoragePort>]: (...args: Parameters<Required<DiscoveryArtifactStoragePort>[K]>) => Awaited<ReturnType<Required<DiscoveryArtifactStoragePort>[K]>> };
export interface ArtifactOptions {
  readonly directory: string; readonly readonly?: boolean;
  readonly mutate: <T>(body: () => T, terminal: boolean) => T;
  readonly checkpoint?: (point: string) => void;
}
/** Synchronous bounded filesystem work belongs to the existing SQLite worker, never the UI. */
export function createDiscoveryArtifacts(database: Database.Database, options: ArtifactOptions): SyncArtifactPort {
  requireDiscoverySchema(Number(database.pragma('user_version', { simple: true })));
  const archive = options.directory, root = join(archive, 'discovery'), objects = join(root, 'objects'), staging = join(root, 'staging');
  const owner = process.getuid!(), roots = new Map<string, Stat>();
  let initialized = false, reconciled = false, blocked = false;
  const reservations = new Map<string, number>();
  const checkpoint = (point: string) => options.checkpoint?.(`artifact.${point}`);
  function privateDirectory(path: string): Stat {
    const stat = lstatSync(path);
    if (!stat.isDirectory() || stat.uid !== owner || (stat.mode & 0o7777) !== 0o700 || realpathSync(path) !== path) fail('ARTIFACT_CORRUPT');
    return stat;
  }
  function checkRoots(create = false) {
    if (!initialized) {
      roots.set(archive, privateDirectory(archive));
      for (const path of [root, objects, staging]) {
        // Never recreate a disappeared root after initialization.
        if (!options.readonly && create && !existsSync(path)) mkdirSync(path, { mode: 0o700 });
        roots.set(path, privateDirectory(path));
      }
      initialized = true;
      if (!options.readonly) for (const path of [staging, objects, root, archive]) syncDirectory(path);
    }
    for (const [path, before] of roots) { const after = privateDirectory(path); if (after.ino !== before.ino || after.dev !== before.dev || after.birthtimeMs !== before.birthtimeMs) fail('ARTIFACT_CORRUPT'); }
  }
  function syncDirectory(path: string) { const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW); try { if (!fstatSync(fd).isDirectory()) fail('ARTIFACT_CORRUPT'); fsyncSync(fd); } finally { closeSync(fd); } }
  function row(id: string) { requireUuid(id); return database.prepare('SELECT * FROM discovery_artifacts WHERE artifact_id=?').get(id) as Row | undefined; }
  function objectPath(a: Row) { requireUuid(String(a.relative_key)); if (a.relative_key !== a.artifact_id) fail('ARTIFACT_CORRUPT'); return join(objects, String(a.relative_key)); }
  function load(a: Row): Buffer {
    checkRoots(); let fd: number | undefined;
    try {
      fd = openSync(objectPath(a), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const before = fstatSync(fd);
      if (!isPrivateArtifact(before, owner) || !Object.hasOwn(caps, String(a.kind)) || before.size > caps[a.kind as keyof typeof caps] || before.size < 1) fail('ARTIFACT_CORRUPT');
      const bytes = Buffer.alloc(before.size); let offset = 0;
      while (offset < bytes.length) { const n = readSync(fd, bytes, offset, bytes.length - offset, offset); if (!n) fail('ARTIFACT_CORRUPT'); offset += n; }
      const after = fstatSync(fd), named = lstatSync(objectPath(a));
      if (!isPrivateArtifact(after, owner) || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs || named.ino !== before.ino || named.dev !== before.dev) fail('ARTIFACT_CORRUPT');
      if (typeof a.sha256 !== 'string' || createHash('sha256').update(bytes).digest('hex') !== a.sha256) fail('ARTIFACT_CORRUPT');
      checkRoots(); return bytes;
    } catch { return fail('ARTIFACT_CORRUPT'); } finally { if (fd !== undefined) closeSync(fd); }
  }
  function usage() {
    checkRoots(); let bytes = 0, files = 0, unsafe = false;
    for (const path of [root, objects, staging]) bytes += lstatSync(path).blocks * 512;
    const entries: { stat: Stat; directory: string }[] = [];
    for (const path of [root, objects, staging]) {
      // readDir entries incrementally; unknown directories/links fail closed without traversal.
      const directory = opendirSync(path);
      try {
        for (let item = directory.readSync(); item; item = directory.readSync()) {
          if (path === root && ['objects', 'staging'].includes(item.name)) continue;
          const stat = lstatSync(join(path, item.name)); bytes += stat.blocks * 512; files++;
          if (files > limits.artifactFiles) fail('DISCOVERY_LIMIT');
          entries.push({ stat, directory: path });
        }
      } finally { directory.closeSync(); }
    }
    const pairs = new Map<string, Set<string>>();
    for (const { stat, directory } of entries) { const key = `${stat.dev}:${stat.ino}`; const dirs = pairs.get(key) ?? new Set<string>(); dirs.add(directory); pairs.set(key, dirs); }
    for (const { stat } of entries) {
      // A crash between exclusive link and unlink may leave the same owned inode in
      // both directories. Preserve and charge both names; never read it as published.
      const ownPair = stat.nlink === 2 && pairs.get(`${stat.dev}:${stat.ino}`)?.size === 2;
      if (!isPrivateArtifact({ uid: stat.uid, mode: stat.mode, nlink: ownPair ? 1 : stat.nlink, isFile: () => stat.isFile() }, owner)) unsafe = true;
    }
    return { bytes, files, unsafe };
  }
  function saveUsage(current: ReturnType<typeof usage>) {
    if (current.bytes + discoveryBudget(database).metadataBytes > limits.artifactBytes || current.files > limits.artifactFiles) { blocked = true; fail('DISCOVERY_LIMIT'); }
    database.prepare('UPDATE discovery_budget SET allocated_bytes=?,allocated_files=? WHERE singleton=1').run(current.bytes, current.files);
  }
  function ready() { checkRoots(true); if (!reconciled) { const result = reconcile(); if (!result.ok) fail(result.code); } if (blocked) fail('DISCOVERY_LIMIT'); }
  function writable() { if (options.readonly) fail('UNAUTHORIZED'); }
  function result<T>(body: () => T): DiscoveryResult<T> {
    try { return { ok: true, value: body() }; } catch (error) {
      if (error instanceof Error && ['INVALID_IDENTIFIER', 'ERR_OUT_OF_RANGE'].includes(error.message)) return { ok: false, code: 'INVALID_REQUEST' };
      return discoveryStorageFailure(error);
    }
  }
  function reconcile(): DiscoveryResult<void> {
    return result(() => {
      writable(); checkRoots(true); const current = usage(); let corrupt = current.unsafe;
      options.mutate(() => {
        // Reservations cannot be reused after owner loss. Files never become authoritative by name.
        const records = database.prepare('SELECT * FROM discovery_artifacts').all() as Row[];
        for (const a of records) {
          if (a.state === 'RESERVED') database.prepare("UPDATE discovery_artifacts SET state='ORPHAN',allocated_bytes=0 WHERE artifact_id=?").run(a.artifact_id);
          else if (a.state === 'PUBLISHED' || a.state === 'REFERENCED') {
            try { load(a); } catch { corrupt = true; database.prepare("UPDATE discovery_artifacts SET state='CORRUPT' WHERE artifact_id=?").run(a.artifact_id); }
          }
        }
        database.prepare('UPDATE discovery_budget SET reserved_bytes=0,reserved_files=0 WHERE singleton=1').run(); saveUsage(current);
      }, true);
      reservations.clear(); reconciled = true;
      if (corrupt) { blocked = true; fail('ARTIFACT_CORRUPT'); }
    });
  }
  return {
    reserveDiscoveryArtifact(kind, maximumBytes) {
      return result(() => {
        writable(); ready();
        if (!Object.hasOwn(caps, kind) || !Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > caps[kind]) fail('INVALID_REQUEST');
        const block = Math.max(4096, Number(statfsSync(objects).bsize));
        const reserved = Math.ceil(maximumBytes / block) * block + block;
        const id = randomUUID();
        const budget = discoveryBudget(database);
        if (budget.allocatedBytes + budget.reservedBytes + budget.metadataBytes + reserved + 65536 > limits.artifactBytes - (kind === 'EXIT_PROOF' ? 0 : limits.terminalReserveBytes) || budget.allocatedFiles + budget.reservedFiles + 2 > limits.artifactFiles - (kind === 'EXIT_PROOF' ? 0 : 2)) fail('DISCOVERY_LIMIT');
        options.mutate(() => {
          database.prepare("INSERT INTO discovery_artifacts(artifact_id,kind,relative_key,allocated_bytes,state) VALUES(?,?,?,?,'RESERVED')").run(id, kind, id, reserved);
          database.prepare('UPDATE discovery_budget SET reserved_bytes=reserved_bytes+?,reserved_files=reserved_files+2 WHERE singleton=1').run(reserved);
          // Store logical cap separately in memory; crash invalidates all unfinished reservations.
        }, kind === 'EXIT_PROOF');
        reservations.set(id, maximumBytes); checkpoint('reserved'); return dto(row(id)!);
      });
    },
    publishDiscoveryArtifact(id, input) {
      return result(() => {
        writable(); ready(); const a = row(id); const maximum = reservations.get(id);
        if (!a || a.state !== 'RESERVED' || maximum === undefined) fail('INVALID_TRANSITION');
        if (!(input instanceof Uint8Array) || input.byteLength < 1 || input.byteLength > maximum) fail('CONTEXT_LIMIT');
        const bytes = Buffer.from(input), temp = join(staging, randomUUID()); let fd: number | undefined;
        try {
          checkRoots(); fd = openSync(temp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
          let offset = 0; while (offset < bytes.length) offset += writeSync(fd, bytes, offset, bytes.length - offset);
          checkpoint('written'); fsyncSync(fd); checkpoint('fileSynced');
          if (!isPrivateArtifact(fstatSync(fd), owner)) fail('ARTIFACT_CORRUPT');
          checkRoots(); linkSync(temp, objectPath(a)); checkpoint('published');
          const tempStat = lstatSync(temp), handleStat = fstatSync(fd);
          if (tempStat.ino !== handleStat.ino || tempStat.dev !== handleStat.dev || tempStat.nlink !== 2) fail('ARTIFACT_CORRUPT');
          unlinkSync(temp); closeSync(fd); fd = undefined;
          syncDirectory(staging); syncDirectory(objects); checkpoint('directorySynced'); checkRoots();
          const sha256 = createHash('sha256').update(bytes).digest('hex');
          load({ ...a, sha256 });
          const allocatedBytes = lstatSync(objectPath(a)).blocks * 512, current = usage();
          options.mutate(() => {
            const changed = database.prepare("UPDATE discovery_artifacts SET sha256=?,allocated_bytes=?,state='PUBLISHED',committed_at=? WHERE artifact_id=? AND state='RESERVED'").run(sha256, allocatedBytes, new Date().toISOString(), id);
            if (Number(changed.changes) !== 1) fail('INVALID_TRANSITION');
            database.prepare('UPDATE discovery_budget SET reserved_bytes=reserved_bytes-?,reserved_files=reserved_files-2 WHERE singleton=1').run(a.allocated_bytes);
            saveUsage(current); checkpoint('beforeCommit');
          }, a.kind === 'EXIT_PROOF');
          reservations.delete(id); checkpoint('committed'); return dto(row(id)!);
        } finally { if (fd !== undefined) closeSync(fd); }
      });
    },
    readDiscoveryManifestPage(id, offset, limit) {
      return result(() => {
        if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 20) fail('INVALID_REQUEST');
        const a = row(id); if (!a || a.kind !== 'MANIFEST' || !['PUBLISHED', 'REFERENCED'].includes(String(a.state))) fail('ARTIFACT_CORRUPT');
        let m: import('../ports/discovery-context.js').DiscoveryManifest;
        try { m = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(load(a))) as typeof m; if (!m || typeof m !== 'object') fail('ARTIFACT_CORRUPT'); requireDecimal(m.configRevision); for (const key of [m.storeId, m.projectId, m.snapshotId]) requireUuid(key); }
        catch { return fail('ARTIFACT_CORRUPT'); }
        if (m.snapshotVersion !== 1 || !Array.isArray(m.sources) || m.sources.length > limits.files || offset > m.sources.length || !/^[a-f0-9]{64}$/.test(m.contextDigest)) fail('ARTIFACT_CORRUPT');
        const items: import('../ports/discovery-context.js').DiscoverySource[] = [];
        for (const source of m.sources.slice(offset, offset + limit)) {
          if (!source || typeof source.relativePath !== 'string' || typeof source.sourceId !== 'string' || !/^[a-f0-9]{64}$/.test(source.sourceId) || Buffer.byteLength(source.relativePath) > 4096 || !source.relativePath.isWellFormed() || source.relativePath.startsWith('/') || source.relativePath.split('/').some((part: string) => !part || part === '.' || part === '..') || !/^[a-f0-9]{64}$/.test(source.sha256) || !Number.isInteger(source.byteLength) || source.byteLength < 0 || source.byteLength > limits.fileBytes || !Number.isInteger(source.lineCount) || source.lineCount < 0 || source.lineCount > limits.fileBytes + 1) fail('ARTIFACT_CORRUPT');
          const item = { sourceId: source.sourceId, relativePath: source.relativePath, sha256: source.sha256, byteLength: source.byteLength, lineCount: source.lineCount };
          if (Buffer.byteLength(JSON.stringify([...items, item])) > limits.envelopeBytes - 4096) break; items.push(item);
        }
        if (offset < m.sources.length && !items.length) fail('CONTEXT_LIMIT');
        return { storeId: m.storeId, projectId: m.projectId, snapshotId: m.snapshotId, configRevision: m.configRevision, contextDigest: m.contextDigest, items, nextOffset: offset + items.length < m.sources.length ? offset + items.length : null };
      });
    },
    readDiscoveryArtifact(id, offset, maximumBytes) {
      return result(() => {
        if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > limits.chunkBytes) fail('INVALID_REQUEST');
        const a = row(id); if (!a || !['PUBLISHED', 'REFERENCED'].includes(String(a.state))) fail('ARTIFACT_CORRUPT');
        const bytes = load(a); if (offset > bytes.length) fail('INVALID_REQUEST');
        return { bytes: bytes.subarray(offset, offset + maximumBytes), sha256: String(a.sha256), totalBytes: bytes.length };
      });
    },
    reconcileDiscoveryArtifacts: reconcile,
    getDiscoveryBudget: () => result(() => discoveryBudget(database)),
    discardDiscoveryPreview(id) {
      return result(() => {
        writable(); requireUuid(id);
        options.mutate(() => {
          const s = database.prepare('SELECT * FROM discovery_snapshots WHERE snapshot_id=?').get(id) as Row | undefined;
          if (!s) return;
          if (Number(s.pinned) !== 0 || database.prepare('SELECT 1 FROM discoveries WHERE snapshot_id=? UNION ALL SELECT 1 FROM discovery_revisions WHERE snapshot_id=? LIMIT 1').get(id, id)) fail('APPROVAL_REQUIRED');
          // Remove only the preview metadata. Its immutable objects remain counted orphans.
          database.prepare('DELETE FROM discovery_snapshots WHERE snapshot_id=? AND pinned=0').run(id);
          for (const artifactId of [s.manifest_artifact_id, s.corpus_artifact_id]) if (artifactId) {
            database.prepare("UPDATE discovery_artifacts SET ref_count=max(0,ref_count-1),state=CASE WHEN ref_count<=1 THEN 'ORPHAN' ELSE state END WHERE artifact_id=?").run(artifactId);
          }
        }, true);
      });
    },
  };
}
