import { randomUUID } from 'node:crypto';
import { realpath, lstat } from 'node:fs/promises';
import type { DialogPort, CliCommand } from './ports.ts';
import type { Params } from '../shared/bridge-contract.ts';
import { record, validateAction, uuid } from '../shared/validation.ts';
import { ArchiveContext } from './archive-context.ts';
import type { BridgeRouter } from './bridge.ts';
import type { ActionService } from './action-handlers.ts';
interface RepositoryHandle { path: string; epoch: number; expiresAt: number }
export class ProjectActions {
  private context: ArchiveContext; private dialogs: DialogPort;
  private handles = new Map<string, RepositoryHandle>(); private choosing = false;
  constructor(context: ArchiveContext, dialogs: DialogPort) { this.context = context; this.dialogs = dialogs; context.onChange(() => this.handles.clear()); }
  async chooseRepository() {
    if (this.choosing) throw new Error('LOCAL_BUSY');
    const selected = this.context.capture(); this.choosing = true;
    try {
      const path = await this.dialogs.chooseDirectory('Scegli repository locale esistente'); if (!path) return null;
      if (this.context.capture().view.selectionEpoch !== selected.view.selectionEpoch) throw new Error('STALE_CONTEXT');
      const canonical = await realpath(path); if (!(await lstat(canonical)).isDirectory()) throw new Error('INVALID_INPUT');
      for (const [id, handle] of this.handles) if (handle.expiresAt <= Date.now()) this.handles.delete(id);
      if (this.handles.size >= 32) throw new Error('LOCAL_BUSY');
      const repositoryHandle = randomUUID(); this.handles.set(repositoryHandle, { path: canonical, epoch: selected.view.selectionEpoch, expiresAt: Date.now() + 300_000 });
      return { repositoryHandle, displayPath: canonical };
    } finally { this.choosing = false; }
  }
  async resolve(action: string, input: Params): Promise<CliCommand> {
    const params = structuredClone(validateAction(action, input)), c = this.context.capture();
    if (!action.startsWith('project.')) throw new Error('INVALID_INPUT');
    if (action === 'project.register') {
      const handle = this.handles.get(uuid(params.repositoryHandle));
      if (!handle || handle.epoch !== c.view.selectionEpoch || handle.expiresAt <= Date.now()) throw new Error('STALE_CONTEXT');
      return { namespace: 'project', action: 'register', archive: c.path, params: { path: handle.path,
        ...(params.name === undefined ? {} : { name: String(params.name).trim().normalize('NFC') }), ...(params.baseBranch === undefined ? {} : { baseBranch: params.baseBranch }) } };
    }
    if (action === 'project.update' && params.patch && typeof params.patch === 'object') {
      const patch = params.patch as Params; if (typeof patch.name === 'string') patch.name = patch.name.trim().normalize('NFC');
    }
    return { namespace: 'project', action: action.slice(8), archive: c.path, params };
  }
}
export function installProjectActions(router: BridgeRouter, context: ArchiveContext, actions: ActionService | null) {
  const projects = new ProjectActions(context, router.services.dialogs);
  if (actions) actions.resolveProject = (action, params) => projects.resolve(action, params);
  router.register('chooseRepository', async () => ({ repository: await projects.chooseRepository() }));
  let entering = false;
  for (const action of ['open', 'create'] as const) {
    router.register(action === 'open' ? 'openRepository' : 'createRepository', async () => {
      if (!actions) throw new Error('RUNTIME_UNAVAILABLE');
      if (entering) throw new Error('LOCAL_BUSY');
      const selected = context.capture();
      entering = true;
      try {
        const path = await router.services.dialogs.chooseDirectory(action === 'open' ? 'Apri repository locale' : 'Scegli o crea una cartella vuota');
        if (!path) return { context: router.context, canceled: true };
        if (action === 'create' && !await router.services.dialogs.confirmSelection?.('Creare un repository Git in questa cartella?', path)) {
          return { context: router.context, canceled: true };
        }
        const result = await actions.enterRepository(action, path, selected);
        context.apply(selected, result);
        if (result.outcome === 'SUCCEEDED') context.activateProject(uuid(result.data.projectId));
        router.setContext(context.capture().view);
        return { context: router.context, canceled: false, result, path };
      } finally { entering = false; }
    });
  }
  router.register('selectProject', async request => {
    if (entering) throw new Error('LOCAL_BUSY');
    if (!router.services.core) throw new Error('RUNTIME_UNAVAILABLE');
    const selected = context.capture(), projectId = uuid(request.projectId);
    const result = await router.services.core.call({ namespace: 'project', action: 'get', archive: selected.path, params: { projectId } });
    context.apply(selected, result);
    if (result.result === 'OK' && record(result.data.project).projectId === projectId) context.activateProject(projectId);
    router.setContext(context.capture().view);
    return { context: router.context, result };
  });
  router.register('closeProject', () => {
    if (entering) throw new Error('LOCAL_BUSY');
    router.setContext(context.activateProject(null));
    return { context: router.context };
  });
  return projects;
}
