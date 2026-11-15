import { ArchiveContext } from './archive-context.ts';
import { ArchiveReader } from './read-handlers.ts';
import type { CorePort } from './ports.ts';
import type { Params } from '../shared/bridge-contract.ts';
import { decodeHistoryPage } from '../shared/activity-contract.ts';
import type { BridgeRouter } from './bridge.ts';
export class ActivityHistory {
  private reader: ArchiveReader;
  constructor(context: ArchiveContext, core: CorePort) { this.reader = new ArchiveReader(context, core); }
  async history(params: Params = {}) {
    const result = await this.reader.read('readEvents', { limit: 100, ...params });
    if (result.result !== 'OK' || result.data.events === undefined) return result;
    if (!result.storeId) throw new Error('CLIENT_PROTOCOL_ERROR');
    const events = decodeHistoryPage(result.data.events, result.storeId);
    return { ...result, data: { events } };
  }
  diagnostics() { return this.reader.read('diagnostics'); }
}
export function installActivityHistory(router: BridgeRouter, context: ArchiveContext) {
  const core = router.services.core;
  const history = core ? new ActivityHistory(context, core) : null;
  router.register('readEvents', async request => {
    if (!history) throw new Error('RUNTIME_UNAVAILABLE');
    try { return await history.history({ ...(request.after === undefined ? {} : { after: request.after }), ...(request.limit === undefined ? {} : { limit: request.limit }) }); }
    finally { router.setContext(context.current?.view ?? null); }
  });
  router.register('diagnostics', async () => {
    if (!history) throw new Error('RUNTIME_UNAVAILABLE');
    try { return await history.diagnostics(); } finally { router.setContext(context.current?.view ?? null); }
  });
  return history;
}
