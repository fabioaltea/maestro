import { execFile, spawn } from 'node:child_process';
import { readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { Deadline } from '../../../ports/clock.js';
import type { InspectionCapabilities, InspectionCode, InspectionFailure } from '../../../ports/repository.js';

const execute = promisify(execFile);
const PROFILE = fileURLToPath(new URL('./inspection.sb', import.meta.url));
const INITIALIZE_PROFILE = fileURLToPath(new URL('./initialize.sb', import.meta.url));
const SANDBOX = '/usr/bin/sandbox-exec';
const MAX_STDOUT = 1024 * 1024;
const MAX_STDERR = 16 * 1024;

export type GitQuery = { readonly kind: 'top-level' | 'common-dir' | 'git-dir'
  | 'object-format' | 'head-symbolic' | 'head-commit' | 'any-commit' | 'status' | 'inventory' | 'initialize' }
  | { readonly kind: 'check-branch' | 'local-branch' | 'branch-exists'; readonly branch: string }
  | { readonly kind: 'spec-index'; readonly oid: string }
  | { readonly kind: 'readme-log'; readonly oid: string; readonly name: string }
  | { readonly kind: 'config-file'; readonly path: string };

export interface GitRunOptions {
  readonly cwd: string;
  readonly deadline: Deadline;
  readonly signal?: AbortSignal;
  readonly maxStdoutBytes?: number;
  readonly maxStderrBytes?: number;
  readonly readRoots?: readonly string[];
}
export type GitRunResult = {
  readonly ok: true; readonly exitCode: number; readonly stdout: Uint8Array;
  readonly stdoutBytes: number; readonly stderrBytes: number;
} | {
  readonly ok: false; readonly error: InspectionFailure;
  readonly stdoutBytes: number; readonly stderrBytes: number;
};
export interface GitRunner {
  capabilities(): Promise<InspectionCapabilities>;
  run(query: unknown, options: GitRunOptions): Promise<GitRunResult>;
}

export function inspectionFailure(code: InspectionCode): InspectionFailure {
  const nextAction: InspectionFailure['nextAction'] = code === 'INVALID_BASE_BRANCH' ? 'select-local-branch'
    : code === 'INVALID_REQUEST' ? 'correct-input'
    : code === 'PATH_ACCESS_DENIED' ? 'restore-access'
    : code === 'REFERENCE_CHECKOUT_UNAVAILABLE' || code === 'REPOSITORY_NOT_FOUND' ? 'restore-checkout'
    : code === 'REPOSITORY_CHANGED' ? 'review-repository-identity'
    : code === 'GIT_UNAVAILABLE' || code === 'REPOSITORY_UNSUPPORTED' ? 'install-supported-git'
    : code === 'INSPECTION_UNSAFE' || code === 'INSPECTION_UNAVAILABLE' ? 'check-inspection-capability'
    : 'retry-inspection';
  return { code, retryable: ['DEADLINE_EXCEEDED', 'INTERRUPTED', 'REPOSITORY_UNSTABLE'].includes(code), nextAction };
}

/** Source is intentionally ignored: no inherited configuration or credential crosses this boundary. */
export function buildInspectionEnvironment(_source: Readonly<Record<string, string | undefined>>,
  home: string): Record<string, string> {
  return { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: home, XDG_CONFIG_HOME: home,
    LC_ALL: 'C', LANG: 'C', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1', GIT_OPTIONAL_LOCKS: '0', GIT_NO_LAZY_FETCH: '1',
    GIT_TERMINAL_PROMPT: '0', GIT_ALLOW_PROTOCOL: '' };
}

function absolute(value: unknown): value is string {
  return typeof value === 'string' && value.isWellFormed() && isAbsolute(value) && !value.includes('\0')
    && Buffer.byteLength(value) <= 16 * 1024;
}
function validBranch(value: unknown): value is string {
  return typeof value === 'string' && value.isWellFormed() && value.length > 0 && Buffer.byteLength(value) <= 1024
    && !/[\x00-\x20\x7f]/.test(value) && !value.startsWith('-') && !value.endsWith('.')
    && !['~', '^', ':', '?', '*', '[', '\\', '@{', '..'].some(token => value.includes(token))
    && !value.split('/').some(part => !part || part.startsWith('.') || part.endsWith('.lock'));
}
function argumentsFor(query: unknown): readonly string[] | InspectionFailure {
  if (!query || typeof query !== 'object' || Array.isArray(query)) return inspectionFailure('INVALID_REQUEST');
  const q = query as Record<string, unknown>;
  const keys = Object.keys(q).sort().join(',');
  if (q.kind === 'spec-index' || q.kind === 'readme-log') {
    if (typeof q.oid !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(q.oid)) return inspectionFailure('INVALID_REQUEST');
    if (q.kind === 'spec-index' && keys === 'kind,oid') return ['ls-tree', '-r', '-z', '--name-only', q.oid, '--', 'specs/'];
    if (q.kind === 'readme-log' && keys === 'kind,name,oid' && typeof q.name === 'string' && /^readme(?:\.(?:md|markdown|txt))?$/i.test(q.name)) {
      return ['--literal-pathspecs', 'log', '-1', '--format=%H%x00%aI%x00%an%x00%s', q.oid, '--', q.name];
    }
    return inspectionFailure('INVALID_REQUEST');
  }
  if (q.kind === 'local-branch' || q.kind === 'check-branch' || q.kind === 'branch-exists') {
    if (keys !== 'branch,kind') return inspectionFailure('INVALID_REQUEST');
    if (!validBranch(q.branch)) return inspectionFailure('INVALID_BASE_BRANCH');
    return q.kind === 'branch-exists' ? ['show-ref', '--exists', `refs/heads/${q.branch}`]
      : q.kind === 'check-branch' ? ['check-ref-format', `refs/heads/${q.branch}`]
      : ['rev-parse', '--verify', '--quiet', '--end-of-options', `refs/heads/${q.branch}^{commit}`];
  }
  if (q.kind === 'config-file') {
    if (keys !== 'kind,path' || !absolute(q.path)) return inspectionFailure('INVALID_REQUEST');
    return ['config', '--null', '--list', '--no-includes', '--file', q.path];
  }
  if (keys !== 'kind') return inspectionFailure('INVALID_REQUEST');
  switch (q.kind) {
    case 'top-level': return ['rev-parse', '--show-toplevel'];
    case 'common-dir': return ['rev-parse', '--path-format=absolute', '--git-common-dir'];
    case 'git-dir': return ['rev-parse', '--absolute-git-dir'];
    case 'object-format': return ['rev-parse', '--show-object-format'];
    case 'head-symbolic': return ['symbolic-ref', '--quiet', 'HEAD'];
    case 'head-commit': return ['rev-parse', '--verify', '--quiet', '--end-of-options', 'HEAD^{commit}'];
    case 'any-commit': return ['rev-list', '--max-count=1', '--all'];
    case 'inventory': return ['ls-files', '-z', '--cached', '--others', '--exclude-standard'];
    case 'initialize': return ['--git-dir=.git', 'init', '--template=', '--initial-branch=main', '--quiet'];
    case 'status': return ['status', '--porcelain=v2', '-z', '--untracked-files=normal', '--ignore-submodules=all'];
    default: return inspectionFailure('INVALID_REQUEST');
  }
}
const PREFIX = ['--no-pager', '--no-optional-locks', '--no-lazy-fetch', '--no-replace-objects',
  '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'submodule.recurse=false',
  '-c', 'maintenance.auto=false', '-c', 'gc.auto=0'];

function sandboxArguments(executable: string, roots: readonly string[], args: readonly string[]): string[] {
  return ['-D', `EXECUTABLE=${executable}`, '-D', `ROOT1=${roots[0]}`,
    '-D', `ROOT2=${roots[1] ?? roots[0]}`, '-D', `ROOT3=${roots[2] ?? roots[0]}`,
    '-f', PROFILE, executable, ...PREFIX, ...args];
}

export function createGitRunner(options: { readonly platform?: string } = {}): GitRunner {
  let qualification: Promise<InspectionCapabilities> | undefined;
  let executable: string | undefined;
  let executableIdentity: string | undefined;
  const env = buildInspectionEnvironment({}, '/var/empty');
  const fingerprint = async (path: string) => {
    const info = await stat(path, { bigint: true });
    if (!info.isFile() || info.uid !== 0n || (info.mode & 0o022n) !== 0n) throw new Error('UNTRUSTED_GIT');
    return `${info.dev}:${info.ino}:${info.birthtimeNs}:${info.mtimeNs}:${info.size}`;
  };
  async function qualify(): Promise<InspectionCapabilities> {
    const unavailable = (code: InspectionCode = 'INSPECTION_UNAVAILABLE'): InspectionCapabilities => ({ version: 1, status: 'UNAVAILABLE',
      gitVersion: null, confinement: 'UNAVAILABLE', error: inspectionFailure(code) });
    if ((options.platform ?? process.platform) !== 'darwin') return unavailable();
    let failureCode: InspectionCode = 'INSPECTION_UNAVAILABLE';
    try {
      await readFile(PROFILE);
      // /usr/bin/git is an Apple dispatcher. Resolve only through the trusted system tool,
      // outside any repository, then pin the actual executable before loading repository config.
      failureCode = 'GIT_UNAVAILABLE';
      const selected = await execute('/usr/bin/xcrun', ['--find', 'git'], {
        cwd: '/', env, timeout: 1_000, maxBuffer: 16 * 1024, encoding: 'utf8',
      });
      const path = selected.stdout.endsWith('\n') ? selected.stdout.slice(0, -1) : selected.stdout;
      const resolved = await realpath(path);
      if (!['/Applications/Xcode.app/Contents/Developer/usr/bin/git',
        '/Library/Developer/CommandLineTools/usr/bin/git'].includes(resolved)) return unavailable('GIT_UNAVAILABLE');
      const identity = await fingerprint(resolved);
      failureCode = 'INSPECTION_UNAVAILABLE';
      const version = await execute(SANDBOX, sandboxArguments(resolved, ['/var/empty'], ['--version']), {
        cwd: '/', env, timeout: 1_000, maxBuffer: 16 * 1024, encoding: 'utf8',
      });
      const gitVersion = version.stdout.replace(/\n$/, '');
      if (!/^git version 2\.50\.1 \(Apple Git-155\)$/.test(gitVersion)) return unavailable('GIT_UNAVAILABLE');
      if (await fingerprint(resolved) !== identity) return unavailable();
      executable = resolved; executableIdentity = identity;
      return { version: 1, status: 'AVAILABLE', gitVersion, confinement: 'MACOS_SANDBOX', error: null };
    } catch { return unavailable(failureCode); }
  }
  function capabilities() { return qualification ??= qualify(); }

  return {
    capabilities,
    async run(query, request) {
      const failure = (code: InspectionCode): GitRunResult => ({ ok: false, error: inspectionFailure(code),
        stdoutBytes: 0, stderrBytes: 0 });
      const args = argumentsFor(query);
      if (!Array.isArray(args)) return { ok: false, error: args as InspectionFailure, stdoutBytes: 0, stderrBytes: 0 };
      if (!absolute(request.cwd) || !Number.isFinite(request.deadline.remainingMs())) return failure('INVALID_REQUEST');
      if (request.signal?.aborted) return failure('INTERRUPTED');
      if (request.deadline.expired()) return failure('DEADLINE_EXCEEDED');
      const limit = request.maxStdoutBytes ?? MAX_STDOUT;
      const stderrLimit = request.maxStderrBytes ?? MAX_STDERR;
      if (!Number.isSafeInteger(limit) || limit < 0 || limit > MAX_STDOUT
        || !Number.isSafeInteger(stderrLimit) || stderrLimit < 0 || stderrLimit > MAX_STDERR) return failure('INVALID_REQUEST');
      if (limit === 0) return failure('OUTPUT_LIMIT');
      if ((await capabilities()).status !== 'AVAILABLE' || !executable) return failure('INSPECTION_UNAVAILABLE');
      let cwd: string, roots: string[];
      try {
        if (await fingerprint(executable) !== executableIdentity) return failure('INSPECTION_UNAVAILABLE');
        const requestedRoots = request.readRoots ?? [request.cwd];
        if (requestedRoots.length < 1 || requestedRoots.length > 3 || !requestedRoots.every(absolute)) return failure('INVALID_REQUEST');
        roots = await Promise.all(requestedRoots.map(path => realpath(path)));
        cwd = await realpath(request.cwd);
      } catch { return failure('PATH_ACCESS_DENIED'); }
      if (request.signal?.aborted) return failure('INTERRUPTED');
      if (request.deadline.expired()) return failure('DEADLINE_EXCEEDED');
      const binary = executable;
      return await new Promise<GitRunResult>(resolve => {
        let error: InspectionCode | undefined;
        let stdoutBytes = 0, stderrBytes = 0;
        const output: Buffer[] = [];
        const initialization = (query as GitQuery).kind === 'initialize';
        const argumentsInSandbox = initialization
          ? ['-D', `EXECUTABLE=${binary}`, '-D', `CHECKOUT=${cwd}`, '-D', `ADMIN=${cwd}/.git`, '-f', INITIALIZE_PROFILE, binary, ...PREFIX, ...args]
          : sandboxArguments(binary, roots, args);
        const child = spawn(SANDBOX, argumentsInSandbox, {
          // Config preflight must not discover a repository and load its includes
          // before --file/--no-includes are processed.
          cwd: (query as GitQuery).kind === 'config-file' ? '/' : cwd,
          env, shell: false, stdio: ['ignore', 'pipe', 'pipe'],
        });
        let escalation: ReturnType<typeof setTimeout> | undefined;
        const cancel = (reason: InspectionCode) => {
          error ??= reason;
          if (child.exitCode !== null || child.signalCode !== null || !child.pid) return;
          child.kill('SIGTERM'); // Only this live ChildProcess handle, never a saved PID.
          escalation ??= setTimeout(() => {
            if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
          }, 150);
        };
        const timer = setTimeout(() => cancel('DEADLINE_EXCEEDED'), Math.min(26_000, request.deadline.remainingMs()));
        const abort = () => cancel('INTERRUPTED');
        request.signal?.addEventListener('abort', abort, { once: true });
        if (request.signal?.aborted) abort();
        child.stdout.on('data', (chunk: Buffer) => {
          stdoutBytes += chunk.byteLength;
          if (stdoutBytes > limit) cancel('OUTPUT_LIMIT');
          else if (!error) output.push(chunk);
        });
        child.stderr.on('data', (chunk: Buffer) => {
          stderrBytes += chunk.byteLength;
          if (stderrBytes > stderrLimit) cancel('OUTPUT_LIMIT');
        });
        child.once('error', () => { error ??= 'INSPECTION_UNAVAILABLE'; });
        child.once('close', (code, signal) => {
          clearTimeout(timer); clearTimeout(escalation);
          request.signal?.removeEventListener('abort', abort);
          if (signal !== null || code === null) error ??= 'INSPECTION_UNAVAILABLE';
          resolve(error ? { ok: false, error: inspectionFailure(error), stdoutBytes, stderrBytes }
            : { ok: true, exitCode: code!, stdout: Buffer.concat(output), stdoutBytes, stderrBytes });
        });
      });
    },
  };
}
