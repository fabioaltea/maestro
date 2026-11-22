import { constants } from 'node:fs';
import { lstat, open, opendir, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import type { Deadline } from '../../../ports/clock.js';
import type { FilesystemAnchor } from '../../../ports/repository.js';
import type { ProjectState } from '../../../ports/registry.js';
import { assertRepositoryIdentity } from './repository-identity-check.js';
import { createGitRunner } from './runner.js';

const MAX_DOCUMENT_BYTES = 48 * 1024;
const readmeNames = ['readme.md', 'readme.markdown', 'readme.txt', 'readme'];
const analysisNames = ['codebase.md', 'codebase-analysis.md', 'codebase_analysis.md'];
const decoder = new TextDecoder('utf-8', { fatal: true });

type Document =
  | { status: 'MISSING' }
  | { status: 'UNAVAILABLE'; name: string }
  | { status: 'READY'; name: string; markdown: string; modifiedAt: string; truncated: boolean };

async function readDocument(root: FilesystemAnchor, name?: string): Promise<Document> {
  if (!name) return { status: 'MISSING' };
  const path = join(root.canonicalPath, name);
  try {
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const before = await file.stat({ bigint: true });
      if (!before.isFile() || before.nlink !== 1n || before.uid !== BigInt(process.getuid!()) || await realpath(path) !== path) throw new Error('PATH_ACCESS_DENIED');
      const buffer = Buffer.alloc(MAX_DOCUMENT_BYTES + 1);
      let offset = 0;
      while (offset < buffer.length) {
        const { bytesRead } = await file.read(buffer, offset, buffer.length - offset, offset);
        if (!bytesRead) break;
        offset += bytesRead;
      }
      const after = await lstat(path, { bigint: true });
      if (before.dev !== after.dev || before.ino !== after.ino || before.birthtimeNs !== after.birthtimeNs ||
        before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs || before.nlink !== after.nlink ||
        BigInt(offset) !== (before.size > BigInt(buffer.length) ? BigInt(buffer.length) : before.size)) throw new Error('REPOSITORY_UNSTABLE');
      const truncated = offset > MAX_DOCUMENT_BYTES;
      let end = Math.min(offset, MAX_DOCUMENT_BYTES);
      if (truncated) while ((buffer[end]! & 0xc0) === 0x80) end--;
      const markdown = decoder.decode(buffer.subarray(0, end));
      if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(markdown)) throw new Error('INVALID_README');
      return { status: 'READY', name, markdown, modifiedAt: new Date(Number(before.mtimeMs)).toISOString(), truncated };
    } finally { await file.close(); }
  } catch {
    return { status: 'UNAVAILABLE', name };
  }
}

export async function readRepositoryDocuments(state: ProjectState, deadline: Deadline) {
  const { projectId, configRevision, referenceCheckout, repositoryIdentity } = state.project;
  const root = referenceCheckout.root;
  const cwd = root.canonicalPath;
  const anchors = [root, referenceCheckout.adminDirectory, repositoryIdentity.commonDirectory];
  await assertRepositoryIdentity(anchors);
  const names = new Map<string, string>();
  const allowed = [...readmeNames, ...analysisNames];
  for await (const entry of await opendir(cwd)) {
    if (deadline.expired()) throw new Error('DEADLINE_EXCEEDED');
    const lower = entry.name.toLowerCase();
    const previous = names.get(lower);
    if (allowed.includes(lower) && (!previous || entry.name < previous)) names.set(lower, entry.name);
  }
  const choose = (candidates: string[]) => candidates.map(name => names.get(name)).find(Boolean);
  const [readme, analysis] = await Promise.all([readDocument(root, choose(readmeNames)), readDocument(root, choose(analysisNames))]);

  const git = createGitRunner();
  const options = { cwd, deadline, readRoots: anchors.map(anchor => anchor.canonicalPath) };
  const head = await git.run({ kind: 'head-commit' }, { ...options, maxStdoutBytes: 128 });
  const oid = head.ok && head.exitCode === 0 ? Buffer.from(head.stdout).toString('ascii').trim() : '';
  let lastCommit: { oid: string; date: string; author: string; subject: string } | null = null;
  let specifications: string[] | null = head.ok && head.exitCode === 1 ? [] : null;
  if (/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(oid)) {
    const [tree, log] = await Promise.all([
      git.run({ kind: 'spec-index', oid }, { ...options, maxStdoutBytes: 256 * 1024 }),
      readme.status === 'READY' ? git.run({ kind: 'readme-log', oid, name: readme.name }, { ...options, maxStdoutBytes: 8192 }) : null,
    ]);
    if (tree.ok && tree.exitCode === 0) {
      specifications = Buffer.from(tree.stdout).toString('utf8').split('\0')
        .filter(path => /^specs\/\d{3,14}-[a-z0-9][a-z0-9-]{0,99}\/spec\.md$/.test(path)).reverse().slice(0, 100);
    }
    if (log?.ok && log.exitCode === 0) {
      const [hash, date, author, subject] = Buffer.from(log.stdout).toString('utf8').trimEnd().split('\0');
      if (hash && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(hash) && date && Number.isFinite(Date.parse(date))) {
        const singleLine = (value: string | undefined) => (value ?? '').replace(/[\p{Cc}\p{Cf}]/gu, '').slice(0, 200);
        lastCommit = { oid: hash, date, author: singleLine(author), subject: singleLine(subject) };
      }
    }
  }
  await assertRepositoryIdentity(anchors);
  return { projectId, configRevision, readme, analysis, lastCommit, specifications };
}
