import { join } from 'node:path';
import type { CorePort } from './ports.ts';
import { ArchiveContext } from './archive-context.ts';
import type { BridgeRouter } from './bridge.ts';
import type { Params, BridgeMethod } from '../shared/bridge-contract.ts';
export class ArchiveReader {
  private context: ArchiveContext;
  private client: CorePort;
  constructor(context: ArchiveContext, client: CorePort) { this.context = context; this.client = client; }
  async read(method: string, params: Params = {}) {
    const c = this.context.capture();
    const project = ['listProjects', 'getProject'].includes(method);
    const action = method === 'listProjects' ? 'list' : method === 'getProject' ? 'get' : method === 'readEvents' ? 'events' : method;
    if (!['status', 'diagnostics', 'listProjects', 'getProject', 'readEvents'].includes(method)) throw new Error('INVALID_INPUT');
    for (let attempt = 0; attempt < 5; attempt++) {
      if (attempt) await new Promise(resolve => setTimeout(resolve, attempt * 50));
      if (this.context.capture().view.selectionEpoch !== c.view.selectionEpoch) throw new Error('STALE_CONTEXT');
      try {
        const result = await this.client.call({ namespace: project ? 'project' : 'daemon', action, archive: c.path, params, scope: 'view' });
        this.context.apply(c, result); return result;
      } catch (error) { if (!(error instanceof Error) || error.message !== 'LOCAL_BUSY' || attempt === 4) throw error; }
    }
    throw new Error('LOCAL_BUSY');
  }
}
export function installReads(router: BridgeRouter, context = new ArchiveContext()) {
  let choosing = false;
  router.register('chooseArchive', async request => {
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
  for (const method of ['status', 'diagnostics', 'listProjects', 'getProject', 'readEvents'] as BridgeMethod[]) router.register(method, async request => {
    if (!router.services.core) throw new Error(router.services.runtimeError ?? 'RUNTIME_UNAVAILABLE');
    const params: Params = {};
    for (const key of ['cursor', 'limit', 'projectId', 'after']) if (request[key] !== undefined) params[key] = request[key];
    try { return await new ArchiveReader(context, router.services.core).read(method, params); }
    finally { router.setContext(context.current?.view ?? null); }
  });
  return context;
}
