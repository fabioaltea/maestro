import { join } from 'node:path';
import type { CorePort } from './ports.ts';
import { ArchiveContext } from './archive-context.ts';
import type { BridgeRouter } from './bridge.ts';
import type { Params, BridgeMethod } from '../shared/bridge-contract.ts';
import { randomUUID } from 'node:crypto';
import { HISTORY_METHODS, oid } from '../shared/repository-history-contract.ts';
import { revision } from '../shared/input.ts';
import { RepositoryReadContext } from './repository-read-context.ts';
import { CODE_METHODS, gitPath } from '../shared/repository-code-contract.ts';
const reviewActions:Record<string,string>={listFeatureReviews:'list',getFeatureReview:'get',getReviewDiffPart:'artifact',getReviewOperation:'operation',
  getReviewReceipt:'receipt',previewReviewCleanup:'cleanup.preview'};
export class ArchiveReader {
  private context: ArchiveContext;
  private client: CorePort;
  constructor(context: ArchiveContext, client: CorePort) { this.context = context; this.client = client; }
  async read(method: string, params: Params = {}) {
    const c = this.context.capture();
    const projectActions: Record<string, string> = { listProjects: 'list', getProject: 'get', getRepositoryDocuments: 'documents' };
    const project = Object.hasOwn(projectActions, method), scheduler=method==='listScheduledJobs',review=Object.hasOwn(reviewActions,method);
    const action = project ? projectActions[method]! : method === 'readEvents' ? 'events' : scheduler?'queue.list':review?reviewActions[method]!:method;
    if (!project&&!review&&!['status', 'diagnostics', 'readEvents', 'listScheduledJobs'].includes(method)) throw new Error('INVALID_INPUT');
    if (method === 'getRepositoryDocuments' && c.view.activeProjectId !== params.projectId) throw new Error('STALE_CONTEXT');
    for (let attempt = 0; attempt < 5; attempt++) {
      if (attempt) await new Promise(resolve => setTimeout(resolve, attempt * 50));
      if (this.context.capture().view.selectionEpoch !== c.view.selectionEpoch) throw new Error('STALE_CONTEXT');
      try {
        const result = await this.client.call({ namespace: project ? 'project' : scheduler?'scheduler':review?'review':'daemon', action, archive: c.path, params, scope: 'view' });
        this.context.apply(c, result); return result;
      } catch (error) { if (!(error instanceof Error) || error.message !== 'LOCAL_BUSY' || attempt === 4) throw error; }
    }
    throw new Error('LOCAL_BUSY');
  }
}
export function installReads(router: BridgeRouter, context = new ArchiveContext(), allowArchiveSelection = true) {
  let choosing = false;
  const snapshots = new RepositoryReadContext();
  context.onChange(() => snapshots.clear());
  let historyGeneration = 0;
  let codeGeneration = 0;
  for (const method of CODE_METHODS) router.register(method, async request => {
    const client = router.services.core;
    if (!client) throw new Error(router.services.runtimeError ?? 'RUNTIME_UNAVAILABLE');
    const selection = context.capture();
    const projectId = String(request.projectId);
    if (selection.view.activeProjectId !== projectId) throw new Error('STALE_CONTEXT');
    const opening = method === 'openRepositoryCode';
    const generation = opening ? ++codeGeneration : codeGeneration;
    const handle = String(request.handle);
    const snapshot = opening ? null : snapshots.read(selection.view, 'code', handle);
    async function read(query: Params) {
      const result = await client!.call({ namespace: 'project', action: 'code', archive: selection.path, requestId: randomUUID(),
        scope: 'view', params: { projectId, query, ...(snapshot ? { configRevision: snapshot.configRevision } : {}) } });
      context.apply(selection, result);
      router.setContext(context.capture().view);
      if (generation !== codeGeneration) throw new Error('STALE_CONTEXT');
      if (!opening) snapshots.read(selection.view, 'code', handle);
      return result;
    }
    if (opening) {
      const result = await read({ kind: 'open' });
      if (result.result !== 'OK' || result.data.status !== 'READY') return result;
      const { nextOffset, ...payload } = result.data;
      const opened = snapshots.open(selection.view, 'code', { configRevision: revision(payload.configRevision), roots: [oid(payload.oid)] });
      return { ...result, data: { ...payload, handle: opened, nextCursor: snapshots.issue(opened, 'tree:', typeof nextOffset === 'number' ? nextOffset : null) } };
    }
    const hash = oid(snapshot!.roots[0]);
    const path = gitPath(request.path, method === 'listRepositoryTree');
    if (method === 'listRepositoryTree') {
      const key = `tree:${path}`;
      const offset = request.cursor === undefined ? 0 : snapshots.offset(handle, key, String(request.cursor));
      const result = await read({ kind: 'tree', oid: hash, path, offset });
      if (result.result !== 'OK') return result;
      const { nextOffset, ...payload } = result.data;
      return { ...result, data: { ...payload, nextCursor: snapshots.issue(handle, key, typeof nextOffset === 'number' ? nextOffset : null) } };
    }
    let offset = 0;
    const chunks: Buffer[] = [];
    for (let part = 0; part < 32; part++) {
      const result = await read({ kind: 'blob', oid: hash, path, offset });
      if (result.result !== 'OK' || result.data.status !== 'READY') return result;
      const { size, chunk, nextOffset, ...payload } = result.data;
      if (typeof chunk !== 'string' || typeof size !== 'number') throw new Error('CLIENT_PROTOCOL_ERROR');
      const bytes = Buffer.from(chunk, 'base64');
      if (bytes.length !== Math.min(32768, size - offset)) throw new Error('CLIENT_PROTOCOL_ERROR');
      chunks.push(bytes);
      if (nextOffset === null) {
        let text: string;
        try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks)); }
        catch (error) { if (!(error instanceof TypeError)) throw error; throw new Error('CLIENT_PROTOCOL_ERROR'); }
        return { ...result, data: { ...payload, text } };
      }
      if (nextOffset !== offset + bytes.length) throw new Error('CLIENT_PROTOCOL_ERROR');
      offset = nextOffset;
    }
    throw new Error('CLIENT_OUTPUT_LIMIT');
  });
  for (const method of HISTORY_METHODS) router.register(method, async request => {
    const client = router.services.core;
    if (!client) throw new Error(router.services.runtimeError ?? 'RUNTIME_UNAVAILABLE');
    const selection = context.capture();
    const projectId = String(request.projectId);
    if (selection.view.activeProjectId !== projectId) throw new Error('STALE_CONTEXT');
    const opening = method === 'openRepositoryHistory';
    const generation = opening ? ++historyGeneration : historyGeneration;
    const existing = String(request.handle);
    const snapshot = opening ? null : snapshots.read(selection.view, 'history', existing);
    const key = method === 'getRepositoryCommit' ? oid(request.oid) : 'log';
    const offset = !opening && request.cursor !== undefined ? snapshots.offset(existing, key, String(request.cursor)) : 0;
    const query = opening ? { kind: 'open' } : { kind: key === 'log' ? 'log' : 'commit',
      offset, roots: snapshot!.roots, ...(key === 'log' ? {} : { oid: key }) };
    const result = await client.call({ namespace: 'project', action: 'history', archive: selection.path, requestId: randomUUID(),
      scope: 'view', params: { projectId, query, ...(snapshot ? { configRevision: snapshot.configRevision } : {}) } });
    context.apply(selection, result);
    router.setContext(context.capture().view);
    if (generation !== historyGeneration) throw new Error('STALE_CONTEXT');
    if (!opening) snapshots.read(selection.view, 'history', existing);
    if (result.result !== 'OK') return result;
    const { roots, nextOffset, ...payload } = result.data;
    const handle = opening ? snapshots.open(selection.view, 'history', {
      configRevision: revision(payload.configRevision), roots: Array.isArray(roots) ? roots.map(oid) : [],
    }) : existing;
    return { ...result, data: { ...payload, handle, nextCursor: snapshots.issue(handle, key, typeof nextOffset === 'number' ? nextOffset : null) } };
  });
  router.register('chooseArchive', async request => {
    if (!allowArchiveSelection) throw new Error('INVALID_INPUT');
    if (choosing) throw new Error('LOCAL_BUSY');
    choosing = true;
    try {
      const path = await router.services.dialogs.chooseDirectory(request.newArchiveName ? 'Scegli una cartella contenitore per i dati di Maestro' : 'Apri la cartella dati di Maestro');
      if (!path) return { context: router.context, canceled: true };
      await router.services.core?.cancelViewReads?.();
      const selected = await context.select(request.newArchiveName ? join(path, String(request.newArchiveName)) : path);
      router.setContext(selected.view);
      return { context: selected.view, canceled: false };
    } finally { choosing = false; }
  });
  for (const method of ['status', 'diagnostics', 'listProjects', 'getProject', 'getRepositoryDocuments', 'readEvents'] as BridgeMethod[]) router.register(method, async request => {
    if (!router.services.core) throw new Error(router.services.runtimeError ?? 'RUNTIME_UNAVAILABLE');
    const params: Params = {};
    for (const key of ['cursor', 'limit', 'projectId', 'after']) if (request[key] !== undefined) params[key] = request[key];
    try { return await new ArchiveReader(context, router.services.core).read(method, params); }
    finally { router.setContext(context.current?.view ?? null); }
  });
  return context;
}
