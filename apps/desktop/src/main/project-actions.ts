import { randomUUID } from 'node:crypto';
import { realpath, lstat } from 'node:fs/promises';
import type { DialogPort, CliCommand } from './ports.ts';
import type { Params } from '../shared/bridge-contract.ts';
import { validateAction, uuid } from '../shared/validation.ts';
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
  return projects;
}
