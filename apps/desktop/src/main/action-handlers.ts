import type { Params, PublicResult } from '../shared/bridge-contract.ts';
import { validateAction, record } from '../shared/validation.ts';
import { Confirmations, blocksMutation } from './confirmations.ts';
import type { ConfirmationScope } from './confirmations.ts';
import { ReceiptStore } from './receipt-store.ts';
import type { Receipt } from './receipt-store.ts';
import { ArchiveContext } from './archive-context.ts';
import type { CliCommand, CorePort } from './ports.ts';
import { unknownResult } from './core-cli.ts';
interface Options { context: ArchiveContext; receipts: ReceiptStore; core: CorePort; owner(): { owner: number; frame: number }; confirmations?: Confirmations }
export async function settleReceipt(store: ReceiptStore, receipt: Receipt, result: PublicResult) {
  const operation = result.data.operation ? record(result.data.operation) : null;
  const action = receipt.namespace === 'project' ? receipt.action.toUpperCase() : receipt.action;
  if (result.requestId !== receipt.requestId || (receipt.storeId && result.storeId && result.storeId !== receipt.storeId)
    || (operation && (operation.requestId !== receipt.requestId || operation.action !== action))) return await store.update(receipt.requestId, { phase: 'UNKNOWN' });
  if (!operation || result.result === 'UNKNOWN_OUTCOME' || result.outcome === null) return await store.update(receipt.requestId, { phase: 'UNKNOWN', errorCode: result.error?.code ?? 'UNKNOWN_OUTCOME' });
  const terminal = ['SUCCEEDED', 'FAILED', 'INTERRUPTED'].includes(result.outcome) || (receipt.namespace === 'project' && result.outcome === 'BLOCKED');
  return await store.update(receipt.requestId, { phase: terminal ? 'TERMINAL' : 'RECONCILING', outcome: result.outcome,
    errorCode: result.error?.code ?? null, ...(result.storeId ? { storeId: result.storeId } : {}) });
}
export class ActionService {
  readonly options: Options;
  readonly confirmations: Confirmations;
  resolveProject: ((action: string, params: Params) => Promise<CliCommand>) | null = null;
  private confirming = false;
  constructor(options: Options) { this.options = options; this.confirmations = options.confirmations ?? new Confirmations(); }
  private scope(): ConfirmationScope {
    const c = this.options.context.capture(); return { ...this.options.owner(), epoch: c.view.selectionEpoch, archiveHandle: c.view.archiveHandle, storeId: c.view.storeId };
  }
  private async preflight(command: CliCommand) {
    const c = this.options.context.capture();
    if (c.path !== command.archive) throw new Error('STALE_CONTEXT');
    const status = await this.options.core.call({ namespace: 'daemon', action: 'status', archive: c.path });
    this.options.context.apply(c, status);
    if (status.result !== 'OK' || (command.namespace === 'daemon' && command.action === 'start' ? !['LIVE_VERIFIED', 'ABSENT_VERIFIED'].includes(status.liveness) : status.liveness !== 'LIVE_VERIFIED')) throw new Error(status.error?.code ?? 'DAEMON_UNAVAILABLE');
    let project: Params | null = null;
    if (command.namespace === 'project' && command.action !== 'register') {
      const detail = await this.options.core.call({ namespace: 'project', action: 'get', archive: c.path, params: { projectId: command.params?.projectId } });
      this.options.context.apply(c, detail);
      if (detail.result !== 'OK') throw new Error(detail.error?.code ?? 'PROJECT_NOT_FOUND');
      project = record(detail.data.project);
      if (['update', 'remove'].includes(command.action) && project.configRevision !== command.params?.expectedRevision) throw new Error('REVISION_CONFLICT');
    }
    return { status, project };
  }
  async prepare(action: string, params: Params) {
    validateAction(action, params);
    if (this.confirming) throw new Error('LOCAL_BUSY');
    const c = this.options.context.capture();
    const command: CliCommand = action.startsWith('daemon.') ? { namespace: 'daemon', action: action.slice(7), archive: c.path } : this.resolveProject ? await this.resolveProject(action, params) : (() => { throw new Error('CONFIRMATION_REQUIRED'); })();
    const namespace = command.namespace === 'daemon' ? 'foundation' : 'project';
    if (blocksMutation(await this.options.receipts.list(), c.path, namespace, command.action, typeof command.params?.projectId === 'string' ? command.params.projectId : undefined)) throw new Error('OPERATION_UNCERTAIN');
    const checked = await this.preflight(command);
    const descriptions: Record<string, string> = { register: 'Importa repository locale', verify: 'Verifica il checkout di riferimento', update: 'Aggiorna la configurazione del progetto', remove: 'Rimuovi la registrazione del progetto' };
    const summary = [command.namespace === 'daemon' ? command.action === 'start' ? 'Avvia il servizio locale' : command.action === 'stop' ? 'Arresta il servizio locale e termina il lavoro Foundation secondo il core' : 'Riavvia il servizio locale' : descriptions[command.action] ?? 'Operazione progetto',
      `Archivio: ${c.path}`, ...(checked.project ? [`Nome: ${checked.project.displayName}`] : []), ...(command.params?.path ? [`Repository: ${command.params.path}`] : []), ...(command.params?.name ? [`Nome: ${command.params.name}`] : []), ...(command.params?.baseBranch ? [`Branch base: ${command.params.baseBranch}`] : []), ...(command.params?.projectId ? [`Progetto: ${command.params.projectId}`] : []), ...(command.params?.expectedRevision ? [`Revisione approvata: ${command.params.expectedRevision}`] : []), ...(command.params?.patch ? Object.entries(record(command.params.patch)).map(([key, value]) => key === 'name' ? `Nome: ${value}` : value === null ? 'Branch base: cancella configurazione' : `Branch base: ${value}`) : []), ...(command.action === 'remove' ? ['Viene rimossa soltanto la registrazione. Repository e file conservati.'] : [])];
    return this.confirmations.prepare(command, this.scope(), summary);
  }
  async confirm(confirmationId: string) {
    if (this.confirming) throw new Error('LOCAL_BUSY');
    const token = this.confirmations.consume(confirmationId, this.scope()); this.confirming = true;
    try {
      await this.preflight(token.command);
      const c = this.options.context.capture(), namespace = token.command.namespace === 'daemon' ? 'foundation' : 'project';
      if (blocksMutation(await this.options.receipts.list(), c.path, namespace, token.command.action, typeof token.command.params?.projectId === 'string' ? token.command.params.projectId : undefined)) throw new Error('OPERATION_UNCERTAIN');
      const receipt = await this.options.receipts.create({ requestId: token.requestId, namespace, action: token.command.action, archivePath: c.path, storeId: c.view.storeId,
        projectId: typeof token.command.params?.projectId === 'string' ? token.command.params.projectId : null, expectedRevision: typeof token.command.params?.expectedRevision === 'string' ? token.command.params.expectedRevision : null, intentHash: token.intentHash });
      try {
        if (this.scope().epoch !== c.view.selectionEpoch) throw new Error('STALE_CONTEXT');
        const result = await this.options.core.call(token.command);
        const final = await settleReceipt(this.options.receipts, receipt, result);
        if (final.phase === 'UNKNOWN') return { receipt: final, result: unknownResult(token.requestId) };
        this.options.context.apply(c, result);
        return { receipt: final, result };
      } catch {
        const unknown = await this.options.receipts.update(token.requestId, { phase: 'UNKNOWN', errorCode: 'UNKNOWN_OUTCOME' }).catch(() => receipt);
        return { receipt: unknown, result: unknownResult(token.requestId) };
      }
    } finally { this.confirming = false; }
  }
}
