import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { systemClock, type Clock } from '../../../ports/clock.js';
import type { BaseState, FilesystemIdentity, HeadKind, InspectionCode, InspectionFailure, InspectionOptions,
  InspectionResult, ObjectFormat, ReferenceCheckout, RepositoryIdentity, RepositoryInspector } from '../../../ports/repository.js';
import { createFilesystemIdentity } from './filesystem-identity.js';
import { createGitRunner, inspectionFailure, type GitQuery, type GitRunner, type GitRunResult } from './runner.js';

const MAX_OUTPUT = 1024 * 1024;
const MAX_CONFIG = 1024 * 1024;
const MAX_STDERR = 16 * 1024;
const decoder = new TextDecoder('utf-8', { fatal: true });
class InspectionProblem extends Error {
  constructor(readonly failure: InspectionFailure) { super(failure.code); }
}
const fail = (code: InspectionCode): never => { throw new InspectionProblem(inspectionFailure(code)); };
const pathValid = (path: unknown): path is string => typeof path === 'string' && path.isWellFormed() && isAbsolute(path)
  && !path.includes('\0') && Buffer.byteLength(path) <= 16 * 1024;
function text(data: Uint8Array): string {
  try { return decoder.decode(data); } catch { return fail('REPOSITORY_UNSUPPORTED'); }
}
function line(data: Uint8Array): string {
  const value = text(data);
  return value.endsWith('\n') ? value.slice(0, -1) : value;
}
function classify(error: unknown): InspectionFailure {
  if (error instanceof InspectionProblem) return error.failure;
  const safe: readonly string[] = ['INVALID_REQUEST', 'REPOSITORY_NOT_FOUND', 'REFERENCE_CHECKOUT_UNAVAILABLE',
    'REPOSITORY_UNSUPPORTED', 'REPOSITORY_CHANGED', 'REPOSITORY_UNSTABLE', 'INSPECTION_UNAVAILABLE', 'PATH_ACCESS_DENIED'];
  if (error instanceof Error && safe.includes(error.message)) return inspectionFailure(error.message as InspectionCode);
  const code = error instanceof Error && 'code' in error ? error.code : null;
  return inspectionFailure(code === 'EACCES' || code === 'EPERM' ? 'PATH_ACCESS_DENIED' : 'INSPECTION_UNAVAILABLE');
}
async function boundedFile(path: string, limit: number): Promise<Buffer | null> {
  let handle;
  try {
    const canonical = await realpath(path);
    if (!(await stat(canonical)).isFile()) return fail('REPOSITORY_UNSUPPORTED');
    // Metadata can be hostile: a FIFO must never consume the probe's lifetime.
    // Recheck the opened descriptor and forbid a raced final-component symlink.
    handle = await open(canonical, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK | constants.O_NOCTTY);
  }
  catch (error) {
    if (error instanceof Error && 'code' in error && ['ENOENT', 'ENOTDIR'].includes(String(error.code))) return null;
    throw error;
  }
  try {
    const info = await handle.stat();
    if (!info.isFile()) return fail('REPOSITORY_UNSUPPORTED');
    if (info.size > limit) return fail('OUTPUT_LIMIT');
    const buffer = Buffer.alloc(limit + 1);
    let offset = 0;
    while (offset < buffer.byteLength) {
      const result = await handle.read(buffer, offset, buffer.byteLength - offset, null);
      if (result.bytesRead === 0) break;
      offset += result.bytesRead;
    }
    if (offset > limit) return fail('OUTPUT_LIMIT');
    return buffer.subarray(0, offset);
  } finally { await handle.close(); }
}
async function fileKind(path: string): Promise<'directory' | 'file' | null> {
  try { const info = await stat(path); return info.isDirectory() ? 'directory' : info.isFile() ? 'file' : null; }
  catch (error) {
    if (error instanceof Error && 'code' in error && ['ENOENT', 'ENOTDIR'].includes(String(error.code))) return null;
    throw error;
  }
}
interface Topology { readonly identity: RepositoryIdentity; readonly reference: ReferenceCheckout }

export interface DirectInspectorOptions {
  readonly runner?: GitRunner;
  readonly filesystem?: FilesystemIdentity;
  readonly clock?: Clock;
  readonly checkpoint?: (point: string) => Promise<void>;
}

/** Internal to the owned supervisor; composition uses ProbeSupervisor for lifecycle. */
export function createDirectRepositoryInspector(dependencies: DirectInspectorOptions = {}): RepositoryInspector {
  const runner = dependencies.runner ?? createGitRunner();
  const filesystem = dependencies.filesystem ?? createFilesystemIdentity();
  const clock = dependencies.clock ?? systemClock;
  async function topology(path: string, check: () => void): Promise<Topology> {
    check();
    const requested = await filesystem.capture(path, 'directory');
    let cursor = requested.canonicalPath;
    for (let depth = 0; depth < 256; depth++) {
      check();
      const marker = join(cursor, '.git');
      const kind = await fileKind(marker);
      if (kind) {
        let adminPath: string;
        if (kind === 'directory') adminPath = marker;
        else {
          const content = await boundedFile(marker, 16 * 1024);
          if (!content) return fail('REPOSITORY_UNSTABLE');
          const value = line(content);
          if (!value.startsWith('gitdir: ') || value.includes('\0')) return fail('REPOSITORY_UNSUPPORTED');
          adminPath = resolve(cursor, value.slice('gitdir: '.length));
        }
        if (!pathValid(adminPath)) return fail('REPOSITORY_UNSUPPORTED');
        const root = await filesystem.capture(cursor, 'directory');
        const adminDirectory = await filesystem.capture(adminPath, 'directory');
        const common = await boundedFile(join(adminDirectory.canonicalPath, 'commondir'), 16 * 1024);
        const commonPath = common === null ? adminDirectory.canonicalPath : resolve(adminDirectory.canonicalPath, line(common));
        if (!pathValid(commonPath) || commonPath.includes('\0')) return fail('REPOSITORY_UNSUPPORTED');
        const commonDirectory = await filesystem.capture(commonPath, 'directory');
        return { identity: { version: 1, commonDirectory }, reference: { version: 1, root, adminDirectory } };
      }
      // Bare metadata is not a working checkout. Do not silently walk out of it.
      if (await fileKind(join(cursor, 'HEAD')) === 'file' && await fileKind(join(cursor, 'objects')) === 'directory') {
        return fail('REPOSITORY_UNSUPPORTED');
      }
      const parent = dirname(cursor);
      if (parent === cursor) break;
      cursor = parent;
    }
    return fail('REPOSITORY_NOT_FOUND');
  }
  function sameTopology(left: Topology, right: Topology): boolean {
    return filesystem.compare(left.identity.commonDirectory, right.identity.commonDirectory) === 'VERIFIED'
      && filesystem.compare(left.reference.root, right.reference.root) === 'VERIFIED'
      && filesystem.compare(left.reference.adminDirectory, right.reference.adminDirectory) === 'VERIFIED';
  }

  async function inspect(path: string, base: string | null | undefined, options: InspectionOptions,
    expected?: Topology): Promise<InspectionResult> {
    try {
      const check = () => {
        if (options.signal?.aborted) fail('INTERRUPTED');
        if (options.deadline.expired()) fail('DEADLINE_EXCEEDED');
      };
      check();
      if (!pathValid(path)) return fail('INVALID_REQUEST');
      if (base !== null && base !== undefined && typeof base !== 'string') return fail('INVALID_BASE_BRANCH');
      const startedAt = clock.wallUtc();
      const capability = await runner.capabilities();
      check();
      if (capability.status !== 'AVAILABLE') throw new InspectionProblem(capability.error ?? inspectionFailure('INSPECTION_UNAVAILABLE'));
      let current: Topology;
      try { current = await topology(path, check); }
      catch (error) {
        if (expected && error instanceof Error && error.message === 'REPOSITORY_NOT_FOUND') return fail('REFERENCE_CHECKOUT_UNAVAILABLE');
        throw error;
      }
      if (expected && !sameTopology(expected, current)) return fail('REPOSITORY_CHANGED');
      const roots = [...new Set([current.reference.root.canonicalPath, current.reference.adminDirectory.canonicalPath,
        current.identity.commonDirectory.canonicalPath])];
      let stdoutBytes = 0, stderrBytes = 0, configBytes = 0;
      const run = async (query: GitQuery): Promise<Extract<GitRunResult, { ok: true }>> => {
        check();
        const result = await runner.run(query, { cwd: current.reference.root.canonicalPath, deadline: options.deadline,
          ...(options.signal ? { signal: options.signal } : {}), readRoots: roots,
          maxStdoutBytes: MAX_OUTPUT - stdoutBytes, maxStderrBytes: MAX_STDERR - stderrBytes });
        stdoutBytes += result.stdoutBytes; stderrBytes += result.stderrBytes;
        if (!result.ok) throw new InspectionProblem(result.error);
        if (query.kind === 'config-file') {
          configBytes += result.stdoutBytes;
          if (configBytes > MAX_CONFIG) return fail('OUTPUT_LIMIT');
        }
        return result;
      };
      const configs = [...new Set([join(current.identity.commonDirectory.canonicalPath, 'config'),
        join(current.reference.adminDirectory.canonicalPath, 'config.worktree')])];
      const fingerprint = async (path: string): Promise<string | null> => {
        const content = await boundedFile(path, MAX_CONFIG - configBytes);
        if (content === null) return null;
        configBytes += content.byteLength;
        return createHash('sha256').update(content).digest('hex');
      };
      let unsafeStatus = false;
      const configBefore: (string | null)[] = [];
      for (const path of configs) {
        const hash = await fingerprint(path); configBefore.push(hash);
        if (hash === null) continue;
        const config = await run({ kind: 'config-file', path });
        if (config.exitCode !== 0 || config.stderrBytes !== 0) return fail('INSPECTION_UNSAFE');
        for (const record of text(config.stdout).split('\0')) {
          const key = record.split('\n', 1)[0]!.toLowerCase();
          // Other Git metadata commands would expand includes without a generic
          // no-includes switch. Reject before they can read unbounded/FIFO data.
          if (key.startsWith('include.') || key.startsWith('includeif.')) return fail('INSPECTION_UNSAFE');
          if (/^filter\..*\.(clean|process)$/.test(key)) unsafeStatus = true;
        }
      }
      const indexPath = join(current.reference.adminDirectory.canonicalPath, 'index');
      const indexFingerprint = async (): Promise<string | null> => {
        try {
          const value = await stat(indexPath, { bigint: true });
          return `${value.dev}:${value.ino}:${value.birthtimeNs}:${value.mtimeNs}:${value.size}`;
        } catch (error) {
          if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
          throw error;
        }
      };
      const indexBefore = await indexFingerprint();
      for (const [query, wanted] of [
        [{ kind: 'top-level' }, current.reference.root], [{ kind: 'git-dir' }, current.reference.adminDirectory],
        [{ kind: 'common-dir' }, current.identity.commonDirectory],
      ] as const) {
        const result = await run(query);
        if (result.exitCode !== 0 || result.stderrBytes > 0) return fail(unsafeStatus ? 'INSPECTION_UNSAFE' : 'REPOSITORY_UNSUPPORTED');
        const actual = line(result.stdout);
        if (!pathValid(actual)) return fail('REPOSITORY_UNSUPPORTED');
        if (filesystem.compare(wanted, await filesystem.capture(actual, 'directory')) !== 'VERIFIED') return fail('REPOSITORY_CHANGED');
      }
      const formatResult = await run({ kind: 'object-format' });
      const objectFormat = line(formatResult.stdout) as ObjectFormat;
      if (formatResult.exitCode !== 0 || !['sha1', 'sha256'].includes(objectFormat)) return fail('REPOSITORY_UNSUPPORTED');
      const oid = (value: string) => new RegExp(`^[0-9a-f]{${objectFormat === 'sha1' ? 40 : 64}}$`).test(value);
      const symbolic = await run({ kind: 'head-symbolic' });
      const head = await run({ kind: 'head-commit' });
      let currentBranch: string | null = null;
      let headKind: HeadKind;
      let headOid: string | null = null;
      if (head.exitCode === 0) {
        headOid = line(head.stdout);
        if (!oid(headOid)) return fail('REPOSITORY_UNSUPPORTED');
      }
      if (symbolic.exitCode === 0) {
        const ref = line(symbolic.stdout);
        if (!ref.startsWith('refs/heads/')) return fail('REPOSITORY_UNSUPPORTED');
        currentBranch = ref.slice('refs/heads/'.length);
        const exists = await run({ kind: 'branch-exists', branch: currentBranch });
        if (exists.exitCode === 0 && headOid !== null) headKind = 'BRANCH';
        else if (exists.exitCode === 2 && headOid === null) headKind = 'UNBORN';
        else return fail('REPOSITORY_UNSUPPORTED');
      } else if (symbolic.exitCode === 1 && headOid !== null) headKind = 'DETACHED';
      else return fail('REPOSITORY_UNSUPPORTED');
      let hasCommits = headOid !== null;
      let historyResult: Extract<GitRunResult, { ok: true }> | undefined;
      if (!hasCommits) {
        const history = await run({ kind: 'any-commit' });
        historyResult = history;
        const first = line(history.stdout);
        if (history.exitCode !== 0 || (first && !oid(first))) return fail('REPOSITORY_UNSUPPORTED');
        hasCommits = first !== '';
      }
      const proposedBaseBranch = base === undefined ? (headKind === 'BRANCH' ? currentBranch : null) : base;
      let baseState: BaseState = 'UNCONFIGURED';
      let baseOid: string | null = null;
      let baseResult: Extract<GitRunResult, { ok: true }> | undefined;
      if (proposedBaseBranch !== null) {
        const validName = await run({ kind: 'check-branch', branch: proposedBaseBranch });
        if (validName.exitCode !== 0) return fail('INVALID_BASE_BRANCH');
        baseResult = await run({ kind: 'local-branch', branch: proposedBaseBranch });
        if (baseResult.exitCode === 0 && oid(line(baseResult.stdout))) {
          baseState = 'VALID'; baseOid = line(baseResult.stdout);
        } else if (expected) baseState = 'INVALID';
        else return fail('INVALID_BASE_BRANCH');
      }
      let trackedChanges: boolean | null = null, untrackedChanges: boolean | null = null, conflicts: boolean | null = null;
      let observationError: InspectionFailure | null = baseState === 'INVALID' ? inspectionFailure('INVALID_BASE_BRANCH') : null;
      if (!unsafeStatus) {
        const status = await run({ kind: 'status' });
        if (status.exitCode !== 0 || status.stderrBytes > 0) unsafeStatus = true;
        else {
          trackedChanges = false; untrackedChanges = false; conflicts = false;
          const records = text(status.stdout).split('\0');
          for (let index = 0; index < records.length; index++) {
            const record = records[index]!;
            if (!record) continue;
            if (record.startsWith('? ')) untrackedChanges = true;
            else if (record.startsWith('u ')) { conflicts = true; trackedChanges = true; }
            else if (record.startsWith('1 ') || record.startsWith('2 ')) {
              trackedChanges = true;
              if (record.startsWith('2 ')) index++; // Original pathname is a separate NUL record.
            } else return fail('REPOSITORY_UNSUPPORTED');
          }
        }
      }
      if (unsafeStatus) observationError = inspectionFailure('INSPECTION_UNSAFE');
      await dependencies.checkpoint?.('inspection.beforeRecheck');
      if (!sameTopology(current, await topology(current.reference.root.canonicalPath, check))) return fail('REPOSITORY_UNSTABLE');
      for (let index = 0; index < configs.length; index++) {
        if (configBefore[index] !== await fingerprint(configs[index]!)) return fail('REPOSITORY_UNSTABLE');
      }
      if (indexBefore !== await indexFingerprint()) return fail('REPOSITORY_UNSTABLE');
      for (const [query, before] of [[{ kind: 'head-symbolic' }, symbolic], [{ kind: 'head-commit' }, head],
        ...(historyResult ? [[{ kind: 'any-commit' }, historyResult] as const] : []),
        ...(proposedBaseBranch !== null && baseResult ? [[{ kind: 'local-branch', branch: proposedBaseBranch }, baseResult] as const] : []),
      ] as readonly (readonly [GitQuery, Extract<GitRunResult, { ok: true }>])[]) {
        const after = await run(query);
        if (after.exitCode !== before.exitCode || text(after.stdout) !== text(before.stdout)) return fail('REPOSITORY_UNSTABLE');
      }
      check();
      return { ok: true, value: { ...current, proposedBaseBranch, observation: {
        startedAt, completedAt: clock.wallUtc(), referencePath: current.reference.root.canonicalPath,
        checkoutAvailability: 'VERIFIED', repositoryIdentityStatus: 'VERIFIED', hasCommits,
        headKind, currentBranch, headOid, objectFormat, baseState, baseOid,
        trackedChanges, untrackedChanges, conflicts, fileStatusScope: 'REFERENCE_CHECKOUT_DIRECT_ENTRIES',
        limitations: unsafeStatus ? ['SUBMODULE_CONTENTS_NOT_INSPECTED', 'FILE_STATUS_UNVERIFIED']
          : ['SUBMODULE_CONTENTS_NOT_INSPECTED'], error: observationError,
      } } };
    } catch (error) { return { ok: false, error: classify(error) }; }
  }

  return {
    capabilities: () => runner.capabilities(),
    inspectCandidate: (path, base, options) => inspect(path, base, options),
    inspectRegistered: (identity, reference, base, options) => inspect(reference.root.canonicalPath,
      base, options, { identity, reference }),
  };
}
