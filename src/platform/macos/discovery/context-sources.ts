import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { BigIntStats } from 'node:fs';
import type { ContextRequest, DiscoveryContextExtractor, DiscoverySource } from '../../../ports/discovery-context.js';
import type { RepositoryInventory } from '../../../ports/repository.js';
import { discoverySourceExclusion } from '../../../domain/discovery/context-policy.js';
import { DISCOVERY_LIMITS as limits, isDiscoveryFailure } from '../../../domain/discovery/model.js';

type Checkpoint = (point: string, path?: string) => Promise<void>;
const decoder = new TextDecoder('utf-8', { fatal: true });
function fail(code: string): never { throw new Error(code); }
function contains(root: string, path: string) { const rel = relative(root, path); return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('../')); }
function same(a: BigIntStats, b: BigIntStats, content = false) { return a.dev === b.dev && a.ino === b.ino && a.birthtimeNs === b.birthtimeNs && a.uid === b.uid && a.mode === b.mode && (!content || (a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs && a.nlink === b.nlink)); }
function safeRelative(path: string) { return typeof path === 'string' && path.length > 0 && path.isWellFormed() && !isAbsolute(path) && !/[\x00-\x1f\x7f\\]/.test(path) && path.split('/').every(part => part !== '' && part !== '.' && part !== '..'); }
export function createDirectContextExtractor(dependencies: { checkpoint?: Checkpoint } = {}): DiscoveryContextExtractor {
  return { async extract(request: ContextRequest, inventory: RepositoryInventory, options) {
    try {
      const check = () => { if (options.signal?.aborted) fail('INTERRUPTED'); if (options.deadline.expired()) fail('DEADLINE_EXCEEDED'); };
      check();
      const root = inventory.reference.root.canonicalPath, owner = BigInt(process.getuid!()), rootInfo = await lstat(root, { bigint: true });
      if (!rootInfo.isDirectory() || rootInfo.uid !== owner || rootInfo.isSymbolicLink() || rootInfo.dev.toString() !== inventory.reference.root.device || rootInfo.ino.toString() !== inventory.reference.root.inode || rootInfo.birthtimeNs.toString() !== inventory.reference.root.birthtimeNs) fail('CONTEXT_UNSTABLE');
      if (await realpath(request.checkoutPath) !== root) fail('CONTEXT_UNSTABLE');
      const excluded: string[] = [];
      for (const path of request.excludedRoots) { excluded.push(resolve(path)); try { excluded.push(await realpath(path)); } catch { /* The lexical root remains excluded before creation. */ } }
      const omissions = new Set<string>();
      const forbidden = (path: string) => excluded.some(privateRoot => contains(privateRoot, join(root, path))) ? 'MAESTRO_PRIVATE' : discoverySourceExclusion(path);
      const original = [...new Set(inventory.files.map(file => file.replace(/\/$/, '')))];
      const raw = original.map(path => path.normalize('NFC')).sort();
      if (new Set(raw).size !== raw.length) fail('CONTEXT_UNSTABLE');
      if (raw.some(path => !safeRelative(path))) fail('CONTEXT_UNSTABLE');
      const selected = (path: string) => request.selectors.some(selector => selector === '.' || path === selector || path.startsWith(selector + '/'));
      const candidates: string[] = [];
      for (const path of raw) {
        check(); if (!selected(path)) continue;
        const reason = forbidden(path); if (reason) { omissions.add(reason); continue; }
        candidates.push(path);
      }
      // Explicit selections must not hide an excluded ancestor or select another repository.
      async function ancestors(path: string): Promise<readonly [string, BigIntStats][]> {
        const result: [string, BigIntStats][] = [[root, rootInfo]];
        const parts = path.split('/');
        for (let i = 1; i < parts.length; i++) {
          check(); const ancestor = join(root, ...parts.slice(0, i)), info = await lstat(ancestor, { bigint: true });
          if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== owner) fail('SOURCE_EXCLUDED');
          try { await lstat(join(ancestor, '.git')); fail('SOURCE_EXCLUDED'); } catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
          result.push([ancestor, info]);
        }
        return result;
      }
      async function recheck(chain: readonly [string, BigIntStats][]) {
        for (const [path, expected] of chain) {
          check(); let current: BigIntStats;
          try { current = await lstat(path, { bigint: true }); } catch { return fail('CONTEXT_UNSTABLE'); }
          if (!current.isDirectory() || !same(expected, current)) fail('CONTEXT_UNSTABLE');
        }
      }
      for (const selector of request.selectors) {
        if (selector === '.') continue;
        if (forbidden(selector)) fail('SOURCE_EXCLUDED');
        await ancestors(selector);
        let info: BigIntStats; try { info = await lstat(join(root, selector), { bigint: true }); } catch { return fail('SOURCE_EXCLUDED'); }
        if (info.isSymbolicLink() || info.uid !== owner || (!info.isDirectory() && (!info.isFile() || info.nlink !== 1n))) fail('SOURCE_EXCLUDED');
        if (info.isDirectory()) {
          try { await lstat(join(root, selector, '.git')); fail('SOURCE_EXCLUDED'); } catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
          // A directory appearing as an exact inventory entry is a gitlink/nested boundary.
          if (raw.includes(selector)) fail('SOURCE_EXCLUDED');
        } else if (!raw.includes(selector)) fail('SOURCE_EXCLUDED');
      }
      const sources: DiscoverySource[] = [], texts: { sourceId: string; relativePath: string; sha256: string; text: string }[] = [];
      const finalChecks: { path: string; info: BigIntStats; chain: readonly [string, BigIntStats][] }[] = [];
      const members: string[] = []; let total = 0;
      for (const path of candidates) {
        check(); let handle;
        const explicit = request.selectors.includes(path);
        try {
          const chain = await ancestors(path), named = await lstat(join(root, path), { bigint: true });
          if (!named.isFile() || named.isSymbolicLink() || named.uid !== owner || named.nlink !== 1n) { if (explicit) fail('SOURCE_EXCLUDED'); omissions.add('LINK_SPECIAL_OR_NESTED'); continue; }
          members.push(path);
          if (sources.length >= limits.files || named.size > BigInt(limits.fileBytes)) fail('CONTEXT_LIMIT');
          await dependencies.checkpoint?.('context.beforeOpen', path); await recheck(chain);
          handle = await open(join(root, path), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK | constants.O_NOCTTY);
          const before = await handle.stat({ bigint: true });
          if (!before.isFile() || before.nlink !== 1n || !same(named, before, true)) fail('CONTEXT_UNSTABLE');
          await recheck(chain); await dependencies.checkpoint?.('context.afterOpen', path);
          const bytes = Buffer.alloc(limits.fileBytes + 1); let count = 0;
          while (count < bytes.length) { check(); const part = await handle.read(bytes, count, bytes.length - count, null); if (!part.bytesRead) break; count += part.bytesRead; }
          if (count > limits.fileBytes || total + count > limits.corpusBytes) fail('CONTEXT_LIMIT');
          const after = await handle.stat({ bigint: true }), afterName = await lstat(join(root, path), { bigint: true });
          if (!same(before, after, true) || !same(after, afterName, true)) fail('CONTEXT_UNSTABLE');
          await recheck(chain); const body = bytes.subarray(0, count); let text: string;
          try { text = decoder.decode(body); if (text.includes('\0')) throw new Error(); }
          catch { if (explicit) fail('SOURCE_EXCLUDED'); omissions.add('BINARY_OR_NON_UTF8'); continue; }
          const sha256 = createHash('sha256').update(body).digest('hex'), normalized = path.normalize('NFC');
          if (sources.some(source => source.relativePath === normalized)) fail('CONTEXT_UNSTABLE');
          const sourceId = createHash('sha256').update(normalized + '\0' + sha256).digest('hex');
          sources.push({ sourceId, relativePath: normalized, sha256, byteLength: count, lineCount: count === 0 ? 0 : text.split('\n').length });
          texts.push({ sourceId, relativePath: normalized, sha256, text }); total += count;
          finalChecks.push({ path, info: after, chain });
        } catch (error) {
          if (error instanceof Error && error.message === 'SOURCE_EXCLUDED' && !explicit) { omissions.add('LINK_SPECIAL_OR_NESTED'); continue; }
          throw error;
        } finally { await handle?.close(); }
      }
      for (const item of finalChecks) {
        await recheck(item.chain); const current = await lstat(join(root, item.path), { bigint: true }); if (!same(item.info, current, true)) fail('CONTEXT_UNSTABLE');
      }
      if (!sources.length) fail('SOURCE_EXCLUDED');
      const corpus = Buffer.from(JSON.stringify({ schemaVersion: 1, sources: texts })); if (corpus.length > limits.corpusBytes) fail('CONTEXT_LIMIT');
      const identity = (info: BigIntStats, content: boolean) => [info.dev, info.ino, info.birthtimeNs, info.uid, info.mode, ...(content ? [info.size, info.mtimeNs, info.ctimeNs, info.nlink] : [])].map(value => value.toString());
      const stabilityDigest = createHash('sha256').update(JSON.stringify(finalChecks.map(item => [item.path, identity(item.info, true), item.chain.map(([path, info]) => [relative(root, path), identity(info, false)])]))).digest('hex');
      check(); return { ok: true, value: { sources, corpus, stabilityDigest, inventoryDigest: createHash('sha256').update(JSON.stringify(members)).digest('hex'), omissions: [...omissions].sort() } };
    } catch (error) {
      return { ok: false, code: error instanceof Error && isDiscoveryFailure(error.message) ? error.message : 'CONTEXT_UNSTABLE' };
    }
  } };
}
